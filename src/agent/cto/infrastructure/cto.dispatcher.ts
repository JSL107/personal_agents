import { Injectable, Logger } from '@nestjs/common';

import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeAssignmentOutput } from '../../../humanize/application/humanize-report.adapter';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatAssignmentOutput } from '../../../slack/format/assignment.formatter';
import { buildAssignmentCardBlocks } from '../../../slack/format/assignment-card.builder';
import { GenerateAssignmentUsecase } from '../application/generate-assignment.usecase';
import { OpenAssignmentApprovalUsecase } from '../application/open-assignment-approval.usecase';
import { AssignmentOutput } from '../domain/cto.type';

// CTO worker 의 Router dispatcher.
// 진입 surface:
//   - 슬래시 `/assign` (직접 dispatch — input.text 미사용, slackUserId 만)
//   - Router 의 자연어 intent classify 분류 (`CTO` agentType 으로 라우팅 시)
// chain handoff (PM → CTO) 는 본 step 미적용 — PM dispatcher 가 followUp 만들지 않는다.
// dailyPlanAgentRunId 는 본 step 자동 조회만 — input.contextRefs 가 있어도 무시 (warn 후 fallback).
//
// 분배 직후 실행 승인 카드를 연다 — 사용자가 "응" 한 마디로 BE worker 까지 진행하도록.
// 카드 생성 실패는 분배 결과 자체를 버릴 이유가 아니므로 안내 문구만 낮춰 그대로 노출한다.
@Injectable()
export class CtoDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.CTO;

  private readonly logger = new Logger(CtoDispatcher.name);

  constructor(
    private readonly generateAssignment: GenerateAssignmentUsecase,
    private readonly humanizeService: HumanizeService,
    private readonly openAssignmentApproval: OpenAssignmentApprovalUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateAssignment.execute({
      slackUserId: input.slackUserId,
      dailyPlanAgentRunId: input.contextRefs?.agentRunId,
      ...(input.conversationContext !== undefined
        ? { conversationContext: input.conversationContext }
        : {}),
    });
    const humanized = await humanizeAssignmentOutput(
      outcome.result,
      this.humanizeService,
    );
    const pendingPreviewId = await this.openApproval({
      slackUserId: input.slackUserId,
      ctoAgentRunId: outcome.agentRunId,
      output: outcome.result,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      // 카드를 띄우는 Slack 경로는 blocks 를 쓰고, formattedText 는 알림·폴백용으로 남는다.
      formattedText: formatAssignmentOutput(humanized, {
        awaitingApproval: pendingPreviewId !== null,
      }),
      ...(pendingPreviewId !== null
        ? {
            slackBlocks: buildAssignmentCardBlocks({
              output: humanized,
              previewId: pendingPreviewId,
            }),
          }
        : {}),
    };
  }

  private async openApproval(input: {
    slackUserId: string;
    ctoAgentRunId: number;
    output: AssignmentOutput;
  }): Promise<string | null> {
    try {
      return await this.openAssignmentApproval.execute(input);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `CTO 실행 승인 카드 생성 실패(분배 결과는 그대로 노출) runId=${input.ctoAgentRunId}: ${message}`,
      );
      return null;
    }
  }
}
