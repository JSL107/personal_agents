import { Injectable } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { coerceToDailyPlan } from '../../pm/domain/prompt/previous-plan-formatter';
import { PoShadowException } from '../domain/po-shadow.exception';
import {
  GeneratePoShadowInput,
  PoShadowReport,
} from '../domain/po-shadow.type';
import { PoShadowErrorCode } from '../domain/po-shadow-error-code.enum';
import { parsePoShadowReport } from '../domain/prompt/po-shadow.parser';
import { PO_SHADOW_SYSTEM_PROMPT } from '../domain/prompt/po-shadow-system.prompt';

// /po-shadow — 직전 PM `/today` plan 위에 PO 시각으로 비판적 검토.
// 직전 PM run 이 없으면 NO_RECENT_PLAN 예외 (PO 모드는 항상 plan 을 전제로 함).
// cron 진입 전용 staleness guard — CTO(generate-assignment.usecase.ts:25)와 동일한 18h 기준.
const STALENESS_THRESHOLD_MS = 18 * 60 * 60 * 1000;

@Injectable()
export class GeneratePoShadowUsecase {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    extraContext,
    slackUserId,
    triggerType,
    enforcePlanFreshness,
  }: GeneratePoShadowInput): Promise<AgentRunOutcome<PoShadowReport>> {
    // slackUserId 한정 검색 — 다른 사용자의 PM run 을 검토하지 않게 (codex review b6xkjewd2 P2).
    const snapshot = await this.agentRunService.findLatestSucceededRun({
      agentType: AgentType.PM,
      slackUserId,
    });
    if (!snapshot) {
      throw new PoShadowException({
        code: PoShadowErrorCode.NO_RECENT_PLAN,
        message:
          '검토할 직전 PM 실행이 없습니다. 먼저 `/today` 로 plan 을 생성한 뒤 다시 시도해주세요.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    const planAgeMilliseconds = Date.now() - snapshot.endedAt.getTime();
    if (
      enforcePlanFreshness === true &&
      planAgeMilliseconds > STALENESS_THRESHOLD_MS
    ) {
      throw new PoShadowException({
        code: PoShadowErrorCode.STALE_PLAN,
        message: `직전 PM plan이 ${Math.round(planAgeMilliseconds / 3_600_000)}시간 전입니다. 최신 plan이 없어 PO Shadow 자동 검토를 건너뜁니다.`,
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    const plan = coerceToDailyPlan(snapshot.output);
    if (!plan) {
      throw new PoShadowException({
        code: PoShadowErrorCode.NO_RECENT_PLAN,
        message:
          '직전 PM 실행 결과를 DailyPlan 으로 해석할 수 없습니다 (구버전 출력). 새로운 `/today` 실행 후 다시 시도해주세요.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }

    const trimmedExtra = extraContext.trim();
    const prompt = buildPrompt({
      planJson: JSON.stringify(plan, null, 2),
      planEndedAt: snapshot.endedAt.toISOString(),
      planAgentRunId: snapshot.id,
      extraContext: trimmedExtra,
    });

    return this.agentRunService.execute({
      agentType: AgentType.PO_SHADOW,
      triggerType: triggerType ?? TriggerType.SLACK_COMMAND_PO_SHADOW,
      inputSnapshot: {
        slackUserId,
        sourcePlanAgentRunId: snapshot.id,
        sourcePlanEndedAt: snapshot.endedAt.toISOString(),
        extraContextLength: trimmedExtra.length,
      },
      evidence: [
        {
          sourceType: 'PRIOR_DAILY_PLAN',
          sourceId: String(snapshot.id),
          payload: { plan, endedAt: snapshot.endedAt.toISOString() },
        },
        ...(trimmedExtra.length > 0
          ? [
              {
                sourceType: 'SLACK_COMMAND_PO_SHADOW' as const,
                sourceId: slackUserId,
                payload: { extraContext: trimmedExtra },
              },
            ]
          : []),
      ],
      run: async () => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.PO_SHADOW,
          request: { prompt, systemPrompt: PO_SHADOW_SYSTEM_PROMPT },
        });
        const report = parsePoShadowReport(completion.text);
        return {
          result: report,
          modelUsed: completion.modelUsed,
          output: report,
        };
      },
    });
  }
}

const buildPrompt = ({
  planJson,
  planEndedAt,
  planAgentRunId,
  extraContext,
}: {
  planJson: string;
  planEndedAt: string;
  planAgentRunId: number;
  extraContext: string;
}): string => {
  const sections = [
    `[직전 PM plan — AgentRun #${planAgentRunId}, endedAt ${planEndedAt}]`,
    planJson,
  ];
  if (extraContext.length > 0) {
    sections.push('[추가 컨텍스트]', extraContext);
  } else {
    sections.push('[추가 컨텍스트]', '(없음)');
  }
  return sections.join('\n\n');
};
