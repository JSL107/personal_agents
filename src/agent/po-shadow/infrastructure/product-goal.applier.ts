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
  GoalDeclarationProblem,
  isProductGoalPreviewPayload,
  ProductGoalDraft,
  ProductGoalRecord,
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
    if (draft.successCriterion === null) {
      throw this.rejection('MISSING_CRITERION', []);
    }
    // 카드를 만들 때 검사했어도 저장 직전에 다시 건다. 검사와 저장은 저장소가 직렬화 격리
    // 트랜잭션 하나로 묶는다 — 승인자가 한 명이어도 Slack 의 별도 action 요청은 동시에 처리될 수 있다.
    const result = await this.repository.createGuarded(
      {
        slackUserId,
        title: draft.title,
        successCriterion: draft.successCriterion,
        keywords: draft.keywords,
        dueDate:
          draft.dueDate === null
            ? null
            : new Date(`${draft.dueDate}T00:00:00Z`),
      },
      (activeGoals) => findGoalDeclarationProblem({ draft, activeGoals }),
    );
    if ('problem' in result) {
      throw this.rejection(result.problem, result.activeGoals);
    }
    const created = result.created;
    this.logger.log(`제품 목표 저장 — #${created.id} ${created.title}`);
    return {
      message: `🧭 목표를 저장했습니다 — *${escapeSlackMrkdwn(created.title)}*`,
      artifacts: [],
    };
  }

  private rejection(
    problem: GoalDeclarationProblem,
    activeGoals: ProductGoalRecord[],
  ): PoShadowException {
    return new PoShadowException({
      code: PoShadowErrorCode.PRODUCT_GOAL_REJECTED,
      message: formatGoalProblem(problem, activeGoals),
      status: DomainStatus.PRECONDITION_FAILED,
    });
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
