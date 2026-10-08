import { Inject, Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ApplyResult } from '../../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
  PreviewKind,
} from '../../../preview-gate/domain/preview-action.type';
import { escapeSlackMrkdwn } from '../../../slack/format/mrkdwn.util';
import { formatGoalProblem } from '../../../slack/format/product-goal.formatter';
import { PoShadowException } from '../domain/po-shadow.exception';
import { PoShadowErrorCode } from '../domain/po-shadow-error-code.enum';
import {
  PRODUCT_GOAL_REPOSITORY_PORT,
  ProductGoalRepositoryPort,
} from '../domain/port/product-goal.repository.port';
import {
  findGoalDeclarationProblem,
  isProductGoalPreviewPayload,
  ProductGoalDraft,
} from '../domain/product-goal';

// 제품 목표를 DB 에 쓰는 유일한 경로. 디스패처와 PO 회차는 카드만 만들고 쓰지 않는다 —
// 목표는 사용자가 카드를 승인했을 때만 생기고 닫힌다.
//
// 카드를 만들 때 검사했어도 여기서 다시 건다. 카드는 만들 때와 누를 때 사이에 시간이 있어,
// 카드 두 장을 띄워 두고 차례로 누르면 생성 시점 검사는 둘 다 통과한다.
@Injectable()
export class ProductGoalApplier implements PreviewApplier {
  readonly kind: PreviewKind = PREVIEW_KIND.PRODUCT_GOAL;
  private readonly logger = new Logger(ProductGoalApplier.name);

  constructor(
    @Inject(PRODUCT_GOAL_REPOSITORY_PORT)
    private readonly repository: ProductGoalRepositoryPort,
  ) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = preview.payload;
    if (!isProductGoalPreviewPayload(payload)) {
      throw new PoShadowException({
        code: PoShadowErrorCode.INVALID_PRODUCT_GOAL_PAYLOAD,
        message: 'PRODUCT_GOAL payload 형식이 맞지 않습니다.',
        status: DomainStatus.INTERNAL,
      });
    }
    if (payload.action === 'CLOSE') {
      return this.close(preview.slackUserId, payload.goalId, payload.title);
    }
    return this.create(preview.slackUserId, payload.draft);
  }

  private async create(
    slackUserId: string,
    draft: ProductGoalDraft,
  ): Promise<ApplyResult> {
    // ponytail: 개수 확인과 저장 사이에 잠금이 없다. 승인자가 owner 한 명이라 두 카드가 같은
    // 순간에 눌리지 않는다는 전제다 — 다중 사용자가 되면 트랜잭션 안의 count + insert 로 옮긴다.
    const activeGoals = await this.repository.findActive(slackUserId);
    const problem = findGoalDeclarationProblem({
      draft,
      activeGoalCount: activeGoals.length,
    });
    if (problem !== null || draft.successCriterion === null) {
      throw new PoShadowException({
        code: PoShadowErrorCode.PRODUCT_GOAL_REJECTED,
        message: formatGoalProblem(problem ?? 'MISSING_CRITERION', activeGoals),
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    const created = await this.repository.create({
      slackUserId,
      title: draft.title,
      successCriterion: draft.successCriterion,
      keywords: draft.keywords,
      dueDate:
        draft.dueDate === null ? null : new Date(`${draft.dueDate}T00:00:00Z`),
    });
    this.logger.log(`제품 목표 저장 — #${created.id} ${created.title}`);
    return {
      message: `🧭 목표를 저장했습니다 — *${escapeSlackMrkdwn(created.title)}*`,
      artifacts: [],
    };
  }

  private async close(
    slackUserId: string,
    goalId: number,
    title: string,
  ): Promise<ApplyResult> {
    const closed = await this.repository.close({
      id: goalId,
      slackUserId,
      closedAt: new Date(),
    });
    return {
      message: closed
        ? `🧭 "${escapeSlackMrkdwn(title)}" 목표를 닫았습니다.`
        : `🧭 "${escapeSlackMrkdwn(title)}" 목표는 이미 닫혀 있습니다.`,
      artifacts: [],
    };
  }
}
