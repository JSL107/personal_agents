import { Injectable, Logger } from '@nestjs/common';
import { App, RespondFn } from '@slack/bolt';

import { GenerateAssignmentUsecase } from '../../agent/cto/application/generate-assignment.usecase';
import {
  AssignmentOutput,
  BeChainOutcome,
} from '../../agent/cto/domain/cto.type';
import { GenerateDailyPlanUsecase } from '../../agent/pm/application/generate-daily-plan.usecase';
import { DailyPlan } from '../../agent/pm/domain/pm-agent.type';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { RunBeChainUsecase } from '../../be-chain/application/run-be-chain.usecase';
import { HumanizeService } from '../../humanize/application/humanize.service';
import { humanizeAssignmentOutput } from '../../humanize/application/humanize-report.adapter';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  extractActionUserId,
  extractActionValue,
} from '../bolt/action-body.parser';
import { SlackHandler } from '../domain/port/slack-handler.port';
import { toReadableSlackArgs } from '../format/message-blocks.builder';

// V3 phase loop chain Phase 2 — PreviewGate 안전판 (사용자 매 step confirm).
// Phase 1 (1-shot 흐름) 은 deprecated — 본 PR 부터 모든 chain step 사이 confirm 강제.
//
// 흐름:
//   1. /auto-flow [tasksText] → PM 만 실행 → 답글 = PM 결과 + "📋 분배 시작" / "❌ 취소" 버튼
//   2. button '📋 분배 시작' (auto-flow:start-cto, value: {pmAgentRunId}) → CTO 실행
//      → 답글 갱신 = CTO 결과 + "🚀 BE chain 시작" / "❌ 취소" 버튼
//   3. button '🚀 BE chain 시작' (auto-flow:start-be, value: {pmAgentRunId, ctoAgentRunId})
//      → BE chain 실행 → 답글 갱신 = 최종 chain 결과
//   4. button '❌ 취소' → 답글 갱신 = "chain 중단" 안내
//   5. CTO/BE step 실패 → 답글 = 에러 + '🔁 다시 시도' 버튼 (같은 run id 상태로 같은 step
//      재실행, step 당 상한 MAX_STEP_RETRY). PM step 실패는 /auto-flow 재실행이 곧 복구라 대상 외.
//
// state 보존: action button value 에 JSON 직렬화 — 별도 DB X. Slack interactive payload 만 활용.
// response_url TTL 30분 — PreviewGate 대신 자체 cap. 30분 후 클릭 시 Slack 이 자동 expire.
//
// C-4 Phase 8 — registerAutoFlowHandler fn → @Injectable() class.

const ACTION_IDS = {
  START_CTO: 'auto-flow:start-cto',
  START_BE: 'auto-flow:start-be',
  CANCEL: 'auto-flow:cancel',
} as const;

interface StartCtoValue {
  pmAgentRunId: number;
  // 이 step 이 실패 후 재시도된 횟수. 실패 응답의 재시도 버튼이 +1 해 싣는다.
  attempt: number;
}

interface StartBeValue {
  pmAgentRunId: number;
  ctoAgentRunId: number;
  attempt: number;
}

// step 실패 시 같은 지점부터 다시 실행하는 버튼 명세. 상한 판정은 buildStepFailureArgs 가 한다.
// 이전 단계 산출물(SUCCEEDED run)은 DB 에 남아 있으므로, 잃는 것은 버튼 value 속
// run id 포인터뿐이다 — 실패 응답이 그 포인터를 다시 실어주면 체인은 복구된다.
export interface StepRetry {
  actionId: (typeof ACTION_IDS)[keyof typeof ACTION_IDS];
  // 실패 시점까지 소진한 재시도 횟수 (초기 실행 = 0)
  attempt: number;
  // 재시도 버튼에 실을 value — attempt + 1 반영본
  nextValueJson: string;
}

interface StepFailureArgs {
  text: string;
  blocks?: SlackBlocks;
}

// step 당 재시도 상한. 주 실패 원인이 쿼터 소진(리셋까지 수 시간)이라 자동 재시도 대신
// 사람이 누르는 버튼으로 두고, 무한 클릭만 막는다.
const MAX_STEP_RETRY = 2;

// Slack Block Kit 의 minimal block type — Bolt 의 (Block | KnownBlock)[] 와 호환 위해
// `as unknown` cast 후 respond 에 전달. KnownBlock 의 strict union 직접 만족시키는 대신
// runtime payload 만 정확하면 OK (Slack API 가 JSON 으로만 검증).
type SlackBlock = { type: string; [key: string]: unknown };
type SlackBlocks = SlackBlock[];

@Injectable()
export class AutoFlowHandler implements SlackHandler {
  private readonly logger = new Logger(AutoFlowHandler.name);

  constructor(
    private readonly generateDailyPlanUsecase: GenerateDailyPlanUsecase,
    private readonly generateAssignmentUsecase: GenerateAssignmentUsecase,
    private readonly runBeChainUsecase: RunBeChainUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly humanizeService: HumanizeService,
  ) {}

  register(app: App): void {
    // step 1 — slash command (PM 만 실행)
    app.command('/auto-flow', async ({ ack, command, respond }) => {
      const tasksText = command.text?.trim() ?? '';
      await ack({
        response_type: 'ephemeral',
        text: 'auto-flow PM step 진행 중 (10~20초 소요)...',
      });
      try {
        const pmOutcome = await this.generateDailyPlanUsecase.execute({
          tasksText,
          slackUserId: command.user_id,
          triggerType: TriggerType.SLACK_COMMAND_AUTO_FLOW,
        });
        const assignableTaskIds = pmOutcome.result.plan.assignableTaskIds ?? [];
        if (assignableTaskIds.length === 0) {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `[1/3] PM plan 완료 (#${pmOutcome.agentRunId}). assignableTaskIds 가 비어 있어 분배 대상이 없습니다. chain 종료.`,
          });
          return;
        }
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          // Bolt 의 (Block | KnownBlock) strict union 과 우리 minimal SlackBlock 의 차이를
          // runtime 동등성 기반으로 우회 — Slack API 는 JSON payload 만 검증.
          blocks: buildPmPreviewBlocks({
            pmAgentRunId: pmOutcome.agentRunId,
            plan: pmOutcome.result.plan,
            assignableCount: assignableTaskIds.length,
          }) as never,
          text: `[1/3] PM plan 완료 (#${pmOutcome.agentRunId}). 분배 ${assignableTaskIds.length}개 대기 — 버튼으로 진행/취소.`,
        });
      } catch (error: unknown) {
        await respondError({
          respond,
          logger: this.logger,
          step: 'PM',
          error,
        });
      }
    });

    // step 2 — "📋 분배 시작" 클릭 → CTO
    app.action(ACTION_IDS.START_CTO, async ({ ack, body, respond }) => {
      await ack();
      const rawValue = extractActionValue(body);
      const slackUserId = extractActionUserId(body);
      if (!rawValue || !slackUserId) {
        return;
      }
      const value = parseStartCtoValue(rawValue);
      if (!value) {
        await respondInvalidState(respond);
        return;
      }
      try {
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `[2/3] CTO 분배 진행 중 (10~30초 소요)... (PM #${value.pmAgentRunId} 기반)`,
        });
        // 안전 — BE step 의 CTO run 가드와 대칭. 버튼 발행 후 /today 가 다시 돌아
        // 최신 PM run 이 바뀌었으면, CTO 는 최신 plan 으로 돌면서 parentId 는 버튼의
        // 옛 run 을 가리켜 chain audit 이 섞인다. 재시도 버튼이 대기 시간을 늘려
        // 이 창이 넓어졌으므로 불일치면 chain 종료.
        const pmRun = await this.agentRunService.findLatestSucceededRun({
          agentType: AgentType.PM,
          slackUserId,
        });
        if (!pmRun || pmRun.id !== value.pmAgentRunId) {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `auto-flow chain — PM run #${value.pmAgentRunId} 가 직전 SUCCEEDED 와 불일치. chain 종료. (다시 \`/auto-flow\` 로 시작)`,
          });
          return;
        }
        const ctoOutcome = await this.generateAssignmentUsecase.execute({
          slackUserId,
        });
        await this.agentRunService.setParentId({
          id: ctoOutcome.agentRunId,
          parentId: value.pmAgentRunId,
        });
        // 표시용 복사본만 윤문 — 식별자·수치는 humanizeAssignmentOutput 이 보존하므로
        // BE chain 버튼 value(taskId/targetFilePath 등)도 안전하다. 다른 표시 경로(/assign·dispatcher)와 일관.
        const displayResult = await humanizeAssignmentOutput(
          ctoOutcome.result,
          this.humanizeService,
        );
        const assignments = ctoOutcome.result.assignments;
        if (assignments.length === 0) {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            ...toReadableSlackArgs(
              `[2/3] CTO 분배 완료 (#${ctoOutcome.agentRunId}) — 자동 분배 가능 assignment 가 없어 chain 종료.\n\n${displayResult.ctoSummary}`,
            ),
          });
          return;
        }
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          blocks: buildCtoPreviewBlocks({
            pmAgentRunId: value.pmAgentRunId,
            ctoAgentRunId: ctoOutcome.agentRunId,
            output: displayResult,
          }) as never,
          text: `[2/3] CTO 분배 완료 (#${ctoOutcome.agentRunId}). BE chain ${assignments.length}개 대기 — 버튼으로 진행/취소.`,
        });
      } catch (error: unknown) {
        await respondError({
          respond,
          logger: this.logger,
          step: 'CTO',
          error,
          retry: {
            actionId: ACTION_IDS.START_CTO,
            attempt: value.attempt,
            nextValueJson: JSON.stringify({
              pmAgentRunId: value.pmAgentRunId,
              attempt: value.attempt + 1,
            } satisfies StartCtoValue),
          },
        });
      }
    });

    // step 3 — "🚀 BE chain 시작" 클릭 → BE chain
    app.action(ACTION_IDS.START_BE, async ({ ack, body, respond }) => {
      await ack();
      const rawValue = extractActionValue(body);
      const slackUserId = extractActionUserId(body);
      if (!rawValue || !slackUserId) {
        return;
      }
      const value = parseStartBeValue(rawValue);
      if (!value) {
        await respondInvalidState(respond);
        return;
      }
      try {
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `[3/3] BE chain 진행 중 (1~3분 소요)... (CTO #${value.ctoAgentRunId} 기반)`,
        });
        const ctoRun = await this.agentRunService.findLatestSucceededRun({
          agentType: AgentType.CTO,
          slackUserId,
        });
        // 안전 — value.ctoAgentRunId 가 사용자의 직전 SUCCEEDED CTO run 과 일치해야.
        // 30분 안 사용자가 다른 /assign 호출했다면 (id 불일치) chain 종료 — race condition 회피.
        if (!ctoRun || ctoRun.id !== value.ctoAgentRunId) {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `auto-flow chain — CTO run #${value.ctoAgentRunId} 가 직전 SUCCEEDED 와 불일치. chain 종료. (다시 \`/auto-flow\` 로 시작)`,
          });
          return;
        }
        const ctoOutput = ctoRun.output as AssignmentOutput;
        const assignments = ctoOutput.assignments ?? [];
        const beOutcomes = await this.runBeChainUsecase.execute({
          assignments,
          slackUserId,
          parentRunId: value.ctoAgentRunId,
          triggerType: TriggerType.SLACK_COMMAND_AUTO_FLOW,
        });
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          ...toReadableSlackArgs(
            formatFinalChainResult({
              pmAgentRunId: value.pmAgentRunId,
              ctoAgentRunId: value.ctoAgentRunId,
              ctoSummary: ctoOutput.ctoSummary,
              beOutcomes,
            }),
          ),
        });
      } catch (error: unknown) {
        await respondError({
          respond,
          logger: this.logger,
          step: 'BE',
          error,
          retry: {
            actionId: ACTION_IDS.START_BE,
            attempt: value.attempt,
            nextValueJson: JSON.stringify({
              pmAgentRunId: value.pmAgentRunId,
              ctoAgentRunId: value.ctoAgentRunId,
              attempt: value.attempt + 1,
            } satisfies StartBeValue),
          },
        });
      }
    });

    // 취소
    app.action(ACTION_IDS.CANCEL, async ({ ack, respond }) => {
      await ack();
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: '❌ auto-flow 중단 — 부작용 없이 종료되었습니다.',
      });
    });
  }
}

// === blocks ===

const buildPmPreviewBlocks = ({
  pmAgentRunId,
  plan,
  assignableCount,
}: {
  pmAgentRunId: number;
  plan: DailyPlan;
  assignableCount: number;
}): SlackBlocks => [
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*[1/3] PM plan 완료 — #${pmAgentRunId}*\n*Top priority*: ${plan.topPriority.title}\n_assignableTaskIds_: ${assignableCount}개`,
    },
  },
  {
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '📋 분배 시작' },
        action_id: ACTION_IDS.START_CTO,
        style: 'primary',
        value: JSON.stringify({
          pmAgentRunId,
          attempt: 0,
        } satisfies StartCtoValue),
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '❌ 취소' },
        action_id: ACTION_IDS.CANCEL,
        style: 'danger',
      },
    ],
  },
];

const buildCtoPreviewBlocks = ({
  pmAgentRunId,
  ctoAgentRunId,
  output,
}: {
  pmAgentRunId: number;
  ctoAgentRunId: number;
  output: AssignmentOutput;
}): SlackBlocks => {
  const assignmentLines = output.assignments
    .map((a) => `• \`[${a.beAssignment}]\` ${a.taskTitle}`)
    .join('\n');
  const unassignedLines =
    output.unassignedTasks.length > 0
      ? `\n\n*⚠️ 분배 보류*\n${output.unassignedTasks.map((u) => `• ${u.taskTitle} — ${u.reason}`).join('\n')}`
      : '';
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*[2/3] CTO 분배 완료 — #${ctoAgentRunId}*\n_${output.ctoSummary}_\n\n${assignmentLines}${unassignedLines}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🚀 BE chain 시작' },
          action_id: ACTION_IDS.START_BE,
          style: 'primary',
          value: JSON.stringify({
            pmAgentRunId,
            ctoAgentRunId,
            attempt: 0,
          } satisfies StartBeValue),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ 취소' },
          action_id: ACTION_IDS.CANCEL,
          style: 'danger',
        },
      ],
    },
  ];
};

// === format ===

// V3 phase loop chain audit 가시화 — PM → CTO → BE 의 AgentRun.id trail 을 한 줄로.
// 사용자가 한 chain 의 흐름을 한 눈에 파악 + 각 run id 로 /retry-run 또는 DB 조회 가능.
// status 가 OK 가 아닌 step (SKIPPED / FAILED) 은 괄호로 표시. agentRunId 미존재 (dispatch
// 실패 등) 는 '—' 로 대체.
export const buildChainTrail = ({
  pmAgentRunId,
  ctoAgentRunId,
  beOutcomes,
}: {
  pmAgentRunId: number;
  ctoAgentRunId: number;
  beOutcomes: BeChainOutcome[];
}): string => {
  const parts = [`PM #${pmAgentRunId}`, `CTO #${ctoAgentRunId}`];
  for (const outcome of beOutcomes) {
    const idSegment =
      outcome.agentRunId !== undefined ? `#${outcome.agentRunId}` : '#—';
    const statusSegment = outcome.status === 'OK' ? '' : ` (${outcome.status})`;
    parts.push(
      `${outcome.assignment.beAssignment} ${idSegment}${statusSegment}`,
    );
  }
  return parts.join(' → ');
};

const formatFinalChainResult = ({
  pmAgentRunId,
  ctoAgentRunId,
  ctoSummary,
  beOutcomes,
}: {
  pmAgentRunId: number;
  ctoAgentRunId: number;
  ctoSummary: string;
  beOutcomes: BeChainOutcome[];
}): string => {
  const lines: string[] = ['*🔁 auto-flow chain 완료*'];
  lines.push('');
  lines.push(`*[P1 PM plan]* #${pmAgentRunId}`);
  lines.push('');
  lines.push(`*[P2 CTO 분배]* #${ctoAgentRunId}`);
  if (ctoSummary.trim().length > 0) {
    lines.push(`_${ctoSummary}_`);
  }
  lines.push('');
  lines.push('*[P3 BE chain]*');
  for (const outcome of beOutcomes) {
    const icon =
      outcome.status === 'OK'
        ? '✅'
        : outcome.status === 'SKIPPED'
          ? '⏭️'
          : '❌';
    lines.push(
      `${icon} \`[${outcome.assignment.beAssignment}]\` ${outcome.assignment.taskTitle} — ${outcome.message}`,
    );
  }
  lines.push('');
  lines.push(
    `*📍 chain trail*: ${buildChainTrail({ pmAgentRunId, ctoAgentRunId, beOutcomes })}`,
  );
  lines.push(
    '_각 worker run id 로 `/retry-run <id>` 가능. chain audit 은 AgentRun.parentId 로._',
  );
  return lines.join('\n');
};

// === value parsing ===

// 재시도 도입 전에 발행된 버튼(attempt 부재)과 조작된 payload 모두 0 으로 수렴.
const normalizeAttempt = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;

export const parseStartCtoValue = (raw: string): StartCtoValue | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { pmAgentRunId?: unknown }).pmAgentRunId === 'number'
    ) {
      return {
        pmAgentRunId: (parsed as StartCtoValue).pmAgentRunId,
        attempt: normalizeAttempt((parsed as { attempt?: unknown }).attempt),
      };
    }
    return null;
  } catch {
    return null;
  }
};

export const parseStartBeValue = (raw: string): StartBeValue | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { pmAgentRunId?: unknown }).pmAgentRunId === 'number' &&
      typeof (parsed as { ctoAgentRunId?: unknown }).ctoAgentRunId === 'number'
    ) {
      const obj = parsed as StartBeValue;
      return {
        pmAgentRunId: obj.pmAgentRunId,
        ctoAgentRunId: obj.ctoAgentRunId,
        attempt: normalizeAttempt((parsed as { attempt?: unknown }).attempt),
      };
    }
    return null;
  } catch {
    return null;
  }
};

// === error helpers ===

const respondInvalidState = async (respond: RespondFn): Promise<void> => {
  await respond({
    response_type: 'ephemeral',
    replace_original: true,
    text: 'auto-flow 상태 deserialize 실패 — chain 종료. (다시 `/auto-flow` 로 시작)',
  });
};

// 실패 응답 본문 — retry 가 있으면 같은 step 을 다시 실행하는 버튼을 붙인다.
// 기존 실패 응답(text 만, replace_original)은 버튼 value 속 체인 상태를 파괴해
// 처음부터 재시작 외 복구 수단이 없었다. 순수 함수로 분리해 spec 에서 직접 검증.
export const buildStepFailureArgs = ({
  step,
  message,
  retry,
}: {
  step: 'PM' | 'CTO' | 'BE';
  message: string;
  retry?: StepRetry;
}): StepFailureArgs => {
  const headline = `auto-flow ${step} step 실패: ${message}`;
  if (!retry) {
    return { text: headline };
  }
  if (retry.attempt >= MAX_STEP_RETRY) {
    return {
      text: `${headline}\n재시도 상한(${MAX_STEP_RETRY}회) 도달 — 다시 \`/auto-flow\` 로 시작해주세요.`,
    };
  }
  return {
    text: headline,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*auto-flow ${step} step 실패*\n${message}\n\n_이전 단계 산출물은 보존되어 있어 같은 지점부터 다시 시도할 수 있습니다. (재시도 ${retry.attempt + 1}/${MAX_STEP_RETRY}회차)_`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: `🔁 ${step} 다시 시도` },
            action_id: retry.actionId,
            style: 'primary',
            value: retry.nextValueJson,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ 취소' },
            action_id: ACTION_IDS.CANCEL,
            style: 'danger',
          },
        ],
      },
    ],
  };
};

const respondError = async ({
  respond,
  logger,
  step,
  error,
  retry,
}: {
  respond: RespondFn;
  logger: Logger;
  step: 'PM' | 'CTO' | 'BE';
  error: unknown;
  retry?: StepRetry;
}): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`/auto-flow ${step} step 실패: ${message}`);
  const failureArgs = buildStepFailureArgs({ step, message, retry });
  await respond({
    response_type: 'ephemeral',
    replace_original: true,
    text: failureArgs.text,
    ...(failureArgs.blocks ? { blocks: failureArgs.blocks as never } : {}),
  });
};
