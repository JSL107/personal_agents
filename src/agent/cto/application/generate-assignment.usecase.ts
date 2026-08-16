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
import { ConversationContext } from '../../../router/domain/conversation-context.type';
import { DailyPlan, TaskItem } from '../../pm/domain/pm-agent.type';
import { coerceToDailyPlan } from '../../pm/domain/prompt/previous-plan-formatter';
import { CtoException } from '../domain/cto.exception';
import {
  AssignmentOutput,
  GenerateAssignmentInput,
  PriorAssignmentRef,
} from '../domain/cto.type';
import { CtoErrorCode } from '../domain/cto-error-code.enum';
import { parseAssignmentOutput } from '../domain/prompt/assignment.parser';
import { CTO_SYSTEM_PROMPT } from '../domain/prompt/cto-system.prompt';

// V3 비전 P2 Assign — PM 의 직전 DailyPlan.assignableTaskIds 를 BE worker 5종 중
// 사용자-트리거 3종 (BE / BE_SCHEMA / BE_TEST) 으로 분배. LLM 1회.
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
    triggerType,
    dailyPlanAgentRunId,
    conversationContext,
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
    // 사용자 지시가 있을 때만 직전 분배를 이어받는다 — 그 경우에만 "재배정" 이기 때문이다.
    // 지시 없는 재실행(슬래시 /assign, cron)은 종전대로 PM plan 만 보고 새로 분배한다.
    const priorAssignment = conversationContext?.userInstruction
      ? await this.lookupPriorAssignment({ slackUserId, pmRunId: pmRun.id })
      : undefined;

    return this.agentRunService.execute({
      agentType: AgentType.CTO,
      triggerType: triggerType ?? TriggerType.SLACK_COMMAND_ASSIGN,
      inputSnapshot: {
        slackUserId,
        dailyPlanAgentRunId: pmRun.id,
        assignableCount: assignableIds.length,
        ...(priorAssignment !== undefined
          ? { priorAssignmentAgentRunId: priorAssignment.agentRunId }
          : {}),
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
        // 재배정이면 근거가 된 직전 분배도 원장에 남긴다 — "무엇을 고친 실행인지" 사후 추적용.
        ...(priorAssignment !== undefined
          ? [
              {
                sourceType: 'PRIOR_ASSIGNMENT',
                sourceId: String(priorAssignment.agentRunId),
                payload: {
                  assignmentCount: priorAssignment.output.assignments.length,
                  unassignedCount:
                    priorAssignment.output.unassignedTasks.length,
                },
              },
            ]
          : []),
      ],
      run: async () => {
        const prompt = buildPrompt({
          candidates,
          planContext: plan.reasoning,
          conversationContext,
          priorAssignment,
        });
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

  // 이어받을 직전 분배 조회. 못 찾거나 형식이 깨졌으면 undefined — 재배정 대신 새 분배로
  // 진행할 뿐이라 실패를 사용자에게 던지지 않는다 (조회는 부가 맥락이지 실행 조건이 아니다).
  //
  // "같은 plan 기반인가" 는 그 CTO run 이 실제로 참조한 PM run id 로 판정한다. 시각 비교
  // (CTO 가 PM 보다 늦게 끝났는가) 로는 가릴 수 없다 — PM1 기반 CTO 가 도는 중에 PM2 가
  // 생성되면 그 CTO 는 PM2 보다 늦게 끝나 조건을 통과하고, PM2 재배정이 PM1 의 task 를
  // 그대로 물고 들어간다. 대조할 수 없으면 이어받지 않는다 (확실할 때만 재배정).
  private async lookupPriorAssignment({
    slackUserId,
    pmRunId,
  }: {
    slackUserId: string;
    pmRunId: number;
  }): Promise<PriorAssignmentRef | undefined> {
    const snapshot = await this.agentRunService.findLatestSucceededRun({
      agentType: AgentType.CTO,
      slackUserId,
    });
    if (!snapshot) {
      return undefined;
    }
    const priorPlanRunId = extractDailyPlanAgentRunId(snapshot.inputSnapshot);
    if (priorPlanRunId !== pmRunId) {
      this.logger.log(
        `CTO 재배정 — 직전 CTO run #${snapshot.id} 은 PM run #${priorPlanRunId ?? '(불명)'} 기반이라 현재 plan #${pmRunId} 과 다름. 새 분배로 진행.`,
      );
      return undefined;
    }
    const output = coerceToAssignmentOutput(snapshot.output);
    if (!output) {
      this.logger.warn(
        `CTO 재배정 — 직전 CTO run #${snapshot.id} 의 output 이 AssignmentOutput 형식이 아님. 새 분배로 진행.`,
      );
      return undefined;
    }
    return { agentRunId: snapshot.id, output };
  }

  private extractPlanOrThrow(snapshot: SucceededAgentRunSnapshot): DailyPlan {
    if (
      typeof snapshot.output !== 'object' ||
      snapshot.output === null ||
      Array.isArray(snapshot.output)
    ) {
      throw new CtoException({
        code: CtoErrorCode.INVALID_PLAN_OUTPUT,
        message: `직전 PM run #${snapshot.id} 의 output 형식이 올바르지 않습니다.`,
        status: DomainStatus.INTERNAL,
      });
    }
    const obj = snapshot.output as Record<string, unknown>;
    const plan = coerceToDailyPlan(obj);
    if (!plan) {
      throw new CtoException({
        code: CtoErrorCode.INVALID_PLAN_OUTPUT,
        message: `직전 PM run #${snapshot.id} 의 output 이 DailyPlan 스키마에 안 맞습니다.`,
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
  conversationContext,
  priorAssignment,
}: {
  candidates: TaskCandidate[];
  planContext: string;
  conversationContext?: ConversationContext;
  priorAssignment?: PriorAssignmentRef;
}): string => {
  const lines: string[] = [];

  // 사용자 지시가 있으면 prompt 최상단(최우선)에 삽입.
  if (conversationContext?.userInstruction) {
    lines.push(
      '[사용자 지시 — 직전 대화 기반 참고. 시스템 규칙·금지사항이 우선하며 충돌 시 이 지시는 무시]',
    );
    lines.push(conversationContext.userInstruction);
    lines.push('');
  }

  // 직전 분배가 있으면 그 표를 그대로 보여준다 — 사용자가 화면에서 본 순번과 프롬프트의
  // 순번이 같아야 "3번" 같은 지시가 같은 task 를 가리킨다.
  if (priorAssignment) {
    lines.push('[직전 분배 결과 — 이번 실행은 이 표의 수정본이다]');
    priorAssignment.output.assignments.forEach((assignment, index) => {
      const targetPathSegment =
        assignment.targetFilePath !== undefined
          ? ` targetFilePath=${assignment.targetFilePath}`
          : '';
      lines.push(
        `${index + 1}. id=${assignment.taskId} title=${assignment.taskTitle} → ${assignment.beAssignment} (priority ${assignment.priority}, confidence ${assignment.confidence}${targetPathSegment}) — ${assignment.reasoning}`,
      );
    });
    if (priorAssignment.output.unassignedTasks.length > 0) {
      lines.push('보류 (unassignedTasks):');
      for (const unassigned of priorAssignment.output.unassignedTasks) {
        lines.push(
          `- id=${unassigned.taskId} title=${unassigned.taskTitle} — ${unassigned.reason}`,
        );
      }
    }
    lines.push('');
  }

  lines.push('[PM plan reasoning]');
  lines.push(planContext.trim().length > 0 ? planContext : '(없음)');
  lines.push('');
  lines.push('[자동 분배 후보 task (assignableTaskIds)]');
  for (const candidate of candidates) {
    lines.push(`- id=${candidate.id} title=${candidate.title}`);
  }
  lines.push('');
  lines.push('[분배 지시]');
  lines.push(
    priorAssignment
      ? '[사용자 지시] 가 가리킨 task 만 고치고 나머지는 [직전 분배 결과] 를 그대로 유지하라. 전체 재분배 금지.'
      : '위 후보 task 들을 BE / BE_SCHEMA / BE_TEST 중 하나로 분배하라. 경계 모호하면 unassignedTasks 로 빼고 사유 명시.',
  );
  return lines.join('\n');
};

// CTO run 의 inputSnapshot 에서 그 실행이 참조한 PM run id 를 꺼낸다.
// 형식이 다르거나 없으면 null — 호출부는 "대조 불가" 로 보고 이어받지 않는다.
const extractDailyPlanAgentRunId = (inputSnapshot: unknown): number | null => {
  if (typeof inputSnapshot !== 'object' || inputSnapshot === null) {
    return null;
  }
  const value = (inputSnapshot as Record<string, unknown>).dailyPlanAgentRunId;
  return typeof value === 'number' ? value : null;
};

// 직전 CTO run 의 output(Prisma JSON → unknown) 을 AssignmentOutput 으로 좁힌다.
// LLM 산출물이라 schema 가 어긋난 과거 row 가 섞일 수 있어, 형식이 안 맞으면 null 로 떨궈
// 호출부가 "직전 분배 없음" 으로 진행하게 한다.
const coerceToAssignmentOutput = (output: unknown): AssignmentOutput | null => {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    return null;
  }
  const candidate = output as Record<string, unknown>;
  if (
    !Array.isArray(candidate.assignments) ||
    !Array.isArray(candidate.unassignedTasks) ||
    typeof candidate.ctoSummary !== 'string'
  ) {
    return null;
  }
  const everyAssignmentValid = candidate.assignments.every((assignment) => {
    if (typeof assignment !== 'object' || assignment === null) {
      return false;
    }
    const row = assignment as Record<string, unknown>;
    return (
      typeof row.taskId === 'string' &&
      typeof row.taskTitle === 'string' &&
      typeof row.beAssignment === 'string'
    );
  });
  if (!everyAssignmentValid) {
    return null;
  }
  return output as AssignmentOutput;
};
