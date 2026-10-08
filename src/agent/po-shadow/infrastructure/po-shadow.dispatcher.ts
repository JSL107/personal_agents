import { Inject, Injectable, Logger } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import {
  findHypotheticalMarker,
  formatHeldWrite,
} from '../../../router/domain/hypothetical-utterance';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { todayInKst } from '../../../schedule/domain/parse-due-date';
import { formatPoShadowReport } from '../../../slack/format/po-shadow.formatter';
import {
  formatGoalCloseAmbiguous,
  formatGoalCloseNotFound,
  formatGoalClosePreview,
  formatGoalCreatePreview,
  formatGoalList,
  formatGoalProblem,
} from '../../../slack/format/product-goal.formatter';
import { GeneratePoShadowUsecase } from '../application/generate-po-shadow.usecase';
import {
  PRODUCT_GOAL_REPOSITORY_PORT,
  ProductGoalRepositoryPort,
} from '../domain/port/product-goal.repository.port';
import {
  findGoalDeclarationProblem,
  matchGoalsByTitle,
  parseProductGoalCommand,
  ProductGoalDraft,
  ProductGoalPreviewPayload,
} from '../domain/product-goal';

// 확인 카드 유효 시간. 선언 직후 승인하는 흐름이라 길게 둘 이유가 없다.
const GOAL_PREVIEW_TTL_MS = 60 * 60 * 1_000;

// PO_SHADOW worker 의 Router dispatcher.
// 제품 목표 선언·조회·닫기는 결정론 파서가 먼저 가른다(ScheduleDispatcher 와 같은 방식).
// 나머지 문장은 지금처럼 extraContext 로 PO 검토에 넘긴다 — 빈 텍스트면 직전 PM run 기반 기본 동작.
//
// 목표를 쓰는 경로는 여기에 없다. 선언·닫기는 확인 카드만 만들고, 저장은 사용자가 승인했을 때
// ProductGoalApplier 가 한다 — 그래서 이 worker 의 안전 등급은 READ_ONLY 로 남는다.
@Injectable()
export class PoShadowDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.PO_SHADOW;
  private readonly logger = new Logger(PoShadowDispatcher.name);

  constructor(
    private readonly generatePoShadow: GeneratePoShadowUsecase,
    @Inject(PRODUCT_GOAL_REPOSITORY_PORT)
    private readonly goalRepository: ProductGoalRepositoryPort,
    private readonly createPreview: CreatePreviewUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const text = input.text?.trim() ?? '';
    const command = parseProductGoalCommand(text, todayInKst(new Date()));

    if (command.kind === 'LIST') {
      const goals = await this.goalRepository.findActive(input.slackUserId);
      return toDeterministicOutcome({ action: 'LIST' }, formatGoalList(goals));
    }

    if (command.kind !== 'NONE') {
      // "목표 저장해도 돼?" 같은 질문은 카드를 만들지 않는다 — 승인 한 번이면 저장되는 카드가
      // 질문에 대한 답으로 뜨면 사용자는 무엇을 승인하는지 모른 채 누르게 된다.
      const marker = findHypotheticalMarker(text);
      if (marker !== null) {
        this.logger.warn(
          `제품 목표 ${command.kind} 보류 — 질문형 원문 (표지=${marker})`,
        );
        return toDeterministicOutcome(
          { action: command.kind, heldBy: marker },
          formatHeldWrite('목표를 반영', '이번 분기 목표는 …, 달성 기준은 …'),
        );
      }
    }

    if (command.kind === 'DECLARE') {
      return this.declare(
        input.slackUserId,
        command.draft,
        command.dueDateUnreadable,
      );
    }
    if (command.kind === 'CLOSE') {
      return this.close(input.slackUserId, command.titleQuery);
    }

    const outcome = await this.generatePoShadow.execute({
      slackUserId: input.slackUserId,
      // GeneratePoShadowInput.extraContext 는 required string — 빈 문자열이면 usecase 가
      // 직전 PM run 기반 default 동작 (외부 컨텍스트 없이) 으로 처리.
      extraContext: text,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatPoShadowReport(outcome.result),
    };
  }

  private async declare(
    slackUserId: string,
    draft: ProductGoalDraft,
    dueDateUnreadable: boolean,
  ): Promise<DispatchOutcome> {
    const activeGoals = await this.goalRepository.findActive(slackUserId);
    const problem = findGoalDeclarationProblem({
      draft,
      activeGoalCount: activeGoals.length,
      dueDateUnreadable,
    });
    if (problem !== null) {
      return toDeterministicOutcome(
        { action: 'DECLARE', problem },
        formatGoalProblem(problem, activeGoals),
      );
    }
    return this.openPreview(
      slackUserId,
      { action: 'CREATE', draft },
      formatGoalCreatePreview(draft),
    );
  }

  private async close(
    slackUserId: string,
    titleQuery: string,
  ): Promise<DispatchOutcome> {
    const activeGoals = await this.goalRepository.findActive(slackUserId);
    const candidates = matchGoalsByTitle(activeGoals, titleQuery);
    if (candidates.length === 0) {
      return toDeterministicOutcome(
        { action: 'CLOSE', matched: 0 },
        formatGoalCloseNotFound(titleQuery, activeGoals),
      );
    }
    if (candidates.length > 1) {
      return toDeterministicOutcome(
        { action: 'CLOSE', matched: candidates.length },
        formatGoalCloseAmbiguous(candidates),
      );
    }
    const [goal] = candidates;
    return this.openPreview(
      slackUserId,
      { action: 'CLOSE', goalId: goal.id, title: goal.title },
      formatGoalClosePreview(goal),
    );
  }

  private async openPreview(
    slackUserId: string,
    payload: ProductGoalPreviewPayload,
    previewText: string,
  ): Promise<DispatchOutcome> {
    const preview = await this.createPreview.execute({
      slackUserId,
      kind: PREVIEW_KIND.PRODUCT_GOAL,
      payload,
      previewText,
      ttlMs: GOAL_PREVIEW_TTL_MS,
    });
    return {
      agentRunId: 0,
      output: { action: payload.action, previewId: preview.id },
      modelUsed: 'deterministic',
      formattedText: previewText,
      preview: { id: preview.id, text: previewText },
    };
  }
}

const toDeterministicOutcome = (
  output: Record<string, unknown>,
  formattedText: string,
): DispatchOutcome => ({
  agentRunId: 0,
  output,
  modelUsed: 'deterministic',
  formattedText,
});
