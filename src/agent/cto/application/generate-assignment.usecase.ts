import { Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { SucceededAgentRunSnapshot } from '../../../agent-run/domain/port/agent-run.repository.port';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DailyPlan, TaskItem } from '../../pm/domain/pm-agent.type';
import { coerceToDailyPlan } from '../../pm/domain/prompt/previous-plan-formatter';
import { CtoException } from '../domain/cto.exception';
import { AssignmentOutput, GenerateAssignmentInput } from '../domain/cto.type';
import { CtoErrorCode } from '../domain/cto-error-code.enum';
import { parseAssignmentOutput } from '../domain/prompt/assignment.parser';
import { CTO_SYSTEM_PROMPT } from '../domain/prompt/cto-system.prompt';

// V3 비전 P2 Assign — PM 의 직전 DailyPlan.assignableTaskIds 를 BE worker 5종 중
// 사용자-트리거 3종 (BE / BE_SCHEMA / BE_TEST) 으로 분배. LLM 1회 (Claude).
// review 합의: 1차는 슬래시 `/assign` 진입만 + "권장 표만" 모드 (BE chain dispatch X).
// staleness guard — 18h 이상 오래된 PM run 은 명시 error.
const STALENESS_THRESHOLD_MS = 18 * 60 * 60 * 1000;

interface TaskCandidate {
  id: string;
  title: string;
}

@Injectable()
export class GenerateAssignmentUsecase {
  private readonly logger = new Logger(GenerateAssignmentUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    slackUserId,
    dailyPlanAgentRunId,
  }: GenerateAssignmentInput): Promise<AgentRunOutcome<AssignmentOutput>> {
    const pmRun = await this.lookupPmRun({ slackUserId, dailyPlanAgentRunId });
    const plan = this.extractPlanOrThrow(pmRun);
    const assignableIds = plan.assignableTaskIds ?? [];
    if (assignableIds.length === 0) {
      throw new CtoException({
        code: CtoErrorCode.NO_ASSIGNABLE_TASKS,
        message:
          '직전 PM run 의 assignableTaskIds 가 비어 있습니다. /today 가 자동 분배 가능 task 를 식별하지 못한 plan.',
        status: DomainStatus.NOT_FOUND,
      });
    }

    const candidates = this.collectCandidates(plan, assignableIds);

    return this.agentRunService.execute({
      agentType: AgentType.CTO,
      triggerType: TriggerType.SLACK_COMMAND_ASSIGN,
      inputSnapshot: {
        slackUserId,
        dailyPlanAgentRunId: pmRun.id,
        assignableCount: assignableIds.length,
      },
      evidence: [
        {
          sourceType: 'PM_PLAN',
          sourceId: String(pmRun.id),
          payload: {
            assignableCount: assignableIds.length,
            planEndedAt: pmRun.endedAt.toISOString(),
          },
        },
      ],
      run: async () => {
        const prompt = buildPrompt({ candidates, planContext: plan.reasoning });
        const completion = await this.modelRouter.route({
          agentType: AgentType.CTO,
          request: { prompt, systemPrompt: CTO_SYSTEM_PROMPT },
        });
        const output = parseAssignmentOutput(completion.text);
        this.logger.log(
          `CTO 분배 완료 — pmRunId=${pmRun.id} assignments=${output.assignments.length} unassigned=${output.unassignedTasks.length}`,
        );
        return {
          result: output,
          modelUsed: completion.modelUsed,
          output,
        };
      },
    });
  }

  private async lookupPmRun({
    slackUserId,
    dailyPlanAgentRunId,
  }: GenerateAssignmentInput): Promise<SucceededAgentRunSnapshot> {
    // 본 step 은 자동 조회 (직전 PM run) 만. 명시 지정은 별도 step — repository.findById 노출 검토 필요.
    if (dailyPlanAgentRunId !== undefined) {
      this.logger.warn(
        `dailyPlanAgentRunId=${dailyPlanAgentRunId} 명시 지정은 본 step 미지원 — 자동 조회로 fallback (slackUserId=${slackUserId})`,
      );
    }
    const snapshot = await this.agentRunService.findLatestSucceededRun({
      agentType: AgentType.PM,
      slackUserId,
    });
    if (!snapshot) {
      throw new CtoException({
        code: CtoErrorCode.NO_RECENT_PM_RUN,
        message:
          '직전 PM run 이 없습니다. `/today` 먼저 실행해 plan 을 만든 뒤 다시 시도해주세요.',
        status: DomainStatus.NOT_FOUND,
      });
    }
    const ageMs = Date.now() - snapshot.endedAt.getTime();
    if (ageMs > STALENESS_THRESHOLD_MS) {
      throw new CtoException({
        code: CtoErrorCode.STALE_PM_RUN,
        message: `직전 PM run 이 ${Math.round(ageMs / 3_600_000)}시간 전 — \`/today\` 로 최신 plan 을 만든 뒤 다시 시도해주세요.`,
        status: DomainStatus.NOT_FOUND,
      });
    }
    return snapshot;
  }

  private extractPlanOrThrow(snapshot: SucceededAgentRunSnapshot): DailyPlan {
    if (
      typeof snapshot.output !== 'object' ||
      snapshot.output === null ||
      Array.isArray(snapshot.output)
    ) {
      throw new CtoException({
        code: CtoErrorCode.NO_ASSIGNABLE_TASKS,
        message: `직전 PM run #${snapshot.id} 의 output 형식이 올바르지 않습니다.`,
        status: DomainStatus.INTERNAL,
      });
    }
    const obj = snapshot.output as Record<string, unknown>;
    const plan = coerceToDailyPlan(obj.plan);
    if (!plan) {
      throw new CtoException({
        code: CtoErrorCode.NO_ASSIGNABLE_TASKS,
        message: `직전 PM run #${snapshot.id} 의 output.plan 이 DailyPlan 스키마에 안 맞습니다.`,
        status: DomainStatus.INTERNAL,
      });
    }
    return plan;
  }

  private collectCandidates(
    plan: DailyPlan,
    assignableIds: string[],
  ): TaskCandidate[] {
    const titleById = new Map<string, string>();
    const allItems: TaskItem[] = [
      plan.topPriority,
      ...plan.morning,
      ...plan.afternoon,
    ];
    for (const item of allItems) {
      titleById.set(item.id, item.title);
    }
    return assignableIds.map((id) => ({
      id,
      title: titleById.get(id) ?? `(plan 안 매핑 안 된 task: ${id})`,
    }));
  }
}

const buildPrompt = ({
  candidates,
  planContext,
}: {
  candidates: TaskCandidate[];
  planContext: string;
}): string => {
  const lines: string[] = [
    '[PM plan reasoning]',
    planContext.trim().length > 0 ? planContext : '(없음)',
    '',
    '[자동 분배 후보 task (assignableTaskIds)]',
  ];
  for (const candidate of candidates) {
    lines.push(`- id=${candidate.id} title=${candidate.title}`);
  }
  lines.push('');
  lines.push('[분배 지시]');
  lines.push(
    '위 후보 task 들을 BE / BE_SCHEMA / BE_TEST 중 하나로 분배하라. 경계 모호하면 unassignedTasks 로 빼고 사유 명시.',
  );
  return lines.join('\n');
};
