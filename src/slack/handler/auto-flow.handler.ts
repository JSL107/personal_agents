import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Logger } from '@nestjs/common';
import { App, RespondFn } from '@slack/bolt';

import { GenerateBackendPlanUsecase } from '../../agent/be/application/generate-backend-plan.usecase';
import { GenerateSchemaProposalUsecase } from '../../agent/be-schema/application/generate-schema-proposal.usecase';
import { GenerateTestUsecase } from '../../agent/be-test/application/generate-test.usecase';
import { GenerateAssignmentUsecase } from '../../agent/cto/application/generate-assignment.usecase';
import {
  Assignment,
  AssignmentOutput,
  BeAssignmentType,
} from '../../agent/cto/domain/cto.type';
import { GenerateDailyPlanUsecase } from '../../agent/pm/application/generate-daily-plan.usecase';
import { DailyPlan } from '../../agent/pm/domain/pm-agent.type';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  extractActionUserId,
  extractActionValue,
} from '../bolt/action-body.parser';

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
//
// state 보존: action button value 에 JSON 직렬화 — 별도 DB X. Slack interactive payload 만 활용.
// response_url TTL 30분 — PreviewGate 대신 자체 cap. 30분 후 클릭 시 Slack 이 자동 expire.

const ACTION_IDS = {
  START_CTO: 'auto-flow:start-cto',
  START_BE: 'auto-flow:start-be',
  CANCEL: 'auto-flow:cancel',
} as const;

export interface AutoFlowHandlerDeps {
  generateDailyPlanUsecase: GenerateDailyPlanUsecase;
  generateAssignmentUsecase: GenerateAssignmentUsecase;
  generateBackendPlanUsecase: GenerateBackendPlanUsecase;
  generateSchemaProposalUsecase: GenerateSchemaProposalUsecase;
  generateTestUsecase: GenerateTestUsecase;
  agentRunService: AgentRunService;
  logger: Logger;
}

interface StartCtoValue {
  pmAgentRunId: number;
}

interface StartBeValue {
  pmAgentRunId: number;
  ctoAgentRunId: number;
}

interface BeChainOutcome {
  assignment: Assignment;
  status: 'OK' | 'SKIPPED' | 'FAILED';
  agentRunId?: number;
  message: string;
}

// Slack Block Kit 의 minimal block type — Bolt 의 (Block | KnownBlock)[] 와 호환 위해
// `as unknown` cast 후 respond 에 전달. KnownBlock 의 strict union 직접 만족시키는 대신
// runtime payload 만 정확하면 OK (Slack API 가 JSON 으로만 검증).
type SlackBlock = { type: string; [key: string]: unknown };
type SlackBlocks = SlackBlock[];

export const registerAutoFlowHandler = (
  app: App,
  deps: AutoFlowHandlerDeps,
): void => {
  // step 1 — slash command (PM 만 실행)
  app.command('/auto-flow', async ({ ack, command, respond }) => {
    const tasksText = command.text?.trim() ?? '';
    await ack({
      response_type: 'ephemeral',
      text: 'auto-flow PM step 진행 중 (10~20초 소요)...',
    });
    try {
      const pmOutcome = await deps.generateDailyPlanUsecase.execute({
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
        logger: deps.logger,
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
      const ctoOutcome = await deps.generateAssignmentUsecase.execute({
        slackUserId,
      });
      await deps.agentRunService.setParentId({
        id: ctoOutcome.agentRunId,
        parentId: value.pmAgentRunId,
      });
      const assignments = ctoOutcome.result.assignments;
      if (assignments.length === 0) {
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `[2/3] CTO 분배 완료 (#${ctoOutcome.agentRunId}) — 자동 분배 가능 assignment 가 없어 chain 종료.\n\n${ctoOutcome.result.ctoSummary}`,
        });
        return;
      }
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        blocks: buildCtoPreviewBlocks({
          pmAgentRunId: value.pmAgentRunId,
          ctoAgentRunId: ctoOutcome.agentRunId,
          output: ctoOutcome.result,
        }) as never,
        text: `[2/3] CTO 분배 완료 (#${ctoOutcome.agentRunId}). BE chain ${assignments.length}개 대기 — 버튼으로 진행/취소.`,
      });
    } catch (error: unknown) {
      await respondError({
        respond,
        logger: deps.logger,
        step: 'CTO',
        error,
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
      const ctoRun = await deps.agentRunService.findLatestSucceededRun({
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
      const beOutcomes: BeChainOutcome[] = [];
      for (const assignment of assignments) {
        const outcome = await runBeWorker({
          assignment,
          slackUserId,
          parentRunId: value.ctoAgentRunId,
          deps,
        });
        beOutcomes.push(outcome);
      }
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: formatFinalChainResult({
          pmAgentRunId: value.pmAgentRunId,
          ctoAgentRunId: value.ctoAgentRunId,
          ctoSummary: ctoOutput.ctoSummary,
          beOutcomes,
        }),
      });
    } catch (error: unknown) {
      await respondError({
        respond,
        logger: deps.logger,
        step: 'BE',
        error,
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
};

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
        value: JSON.stringify({ pmAgentRunId } satisfies StartCtoValue),
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

// === BE chain ===

// BE_TEST 분배 시 CTO 가 추론한 targetFilePath 가 실제 repo 에 존재하는지 검증.
// LLM hallucination 으로 가짜 경로 ("src/example.service.ts" 같은) 가 들어오면 fast-fail.
// 보안: absolute path 는 무조건 false — process.cwd() 밖 (e.g. /etc/passwd) 접근 차단.
// path traversal (../) 은 path.resolve 가 normalize 후 cwd prefix 검사로 추가 차단.
export const fileExistsRelativeToCwd = async (
  relativePath: string,
): Promise<boolean> => {
  if (relativePath.length === 0) {
    return false;
  }
  if (path.isAbsolute(relativePath)) {
    return false;
  }
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, relativePath);
  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    return false;
  }
  try {
    await fs.access(resolved, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const runBeWorker = async ({
  assignment,
  slackUserId,
  parentRunId,
  deps,
}: {
  assignment: Assignment;
  slackUserId: string;
  parentRunId: number;
  deps: AutoFlowHandlerDeps;
}): Promise<BeChainOutcome> => {
  if (assignment.beAssignment === AgentType.BE_TEST) {
    const filePath = assignment.targetFilePath;
    if (filePath === undefined) {
      return {
        assignment,
        status: 'SKIPPED',
        message:
          'BE_TEST — CTO 가 task 설명에서 file path 를 식별하지 못함. 사용자가 별도 `/be-test <filePath>` 호출 필요.',
      };
    }
    // PR #19 follow-up — CTO 가 적은 path 가 실제 repo 에 있는지 검증. hallucination fast-fail.
    const exists = await fileExistsRelativeToCwd(filePath);
    if (!exists) {
      deps.logger.warn(
        `[auto-flow] BE_TEST targetFilePath '${filePath}' 가 repo 에 없음 — CTO hallucination 가능 (taskId=${assignment.taskId}).`,
      );
      return {
        assignment,
        status: 'SKIPPED',
        message: `BE_TEST — CTO 가 추론한 path \`${filePath}\` 가 실제 repo 에 없습니다 (LLM 추측 가능). 사용자가 정확한 경로로 \`/be-test <filePath>\` 별도 호출 권장.`,
      };
    }
    try {
      const outcome = await deps.generateTestUsecase.execute({
        filePath,
        slackUserId,
      });
      await deps.agentRunService.setParentId({
        id: outcome.agentRunId,
        parentId: parentRunId,
      });
      return {
        assignment,
        status: 'OK',
        agentRunId: outcome.agentRunId,
        message: `BE_TEST spec #${outcome.agentRunId} 생성 완료 — ${filePath}.`,
      };
    } catch (error) {
      deps.logger.warn(
        `[auto-flow] BE_TEST dispatch failed — taskId=${assignment.taskId} filePath=${filePath} error=${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        assignment,
        status: 'FAILED',
        message: `BE_TEST 실패 — ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  try {
    if (assignment.beAssignment === AgentType.BE) {
      const outcome = await deps.generateBackendPlanUsecase.execute({
        subject: assignment.taskTitle,
        slackUserId,
      });
      await deps.agentRunService.setParentId({
        id: outcome.agentRunId,
        parentId: parentRunId,
      });
      return {
        assignment,
        status: 'OK',
        agentRunId: outcome.agentRunId,
        message: `BE plan #${outcome.agentRunId} 생성 완료.`,
      };
    }
    if (assignment.beAssignment === AgentType.BE_SCHEMA) {
      const outcome = await deps.generateSchemaProposalUsecase.execute({
        request: assignment.taskTitle,
        slackUserId,
        triggerType: TriggerType.SLACK_COMMAND_AUTO_FLOW,
      });
      await deps.agentRunService.setParentId({
        id: outcome.agentRunId,
        parentId: parentRunId,
      });
      return {
        assignment,
        status: 'OK',
        agentRunId: outcome.agentRunId,
        message: `BE_SCHEMA proposal #${outcome.agentRunId} 생성 완료.`,
      };
    }
    const exhaustive: never =
      assignment.beAssignment satisfies BeAssignmentType;
    return {
      assignment,
      status: 'SKIPPED',
      message: `미지원 worker: ${String(exhaustive)}`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.warn(
      `/auto-flow BE worker (${assignment.beAssignment}, ${assignment.taskId}) 실패: ${message}`,
    );
    return {
      assignment,
      status: 'FAILED',
      message: `${assignment.beAssignment} 실패: ${message}`,
    };
  }
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

const parseStartCtoValue = (raw: string): StartCtoValue | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { pmAgentRunId?: unknown }).pmAgentRunId === 'number'
    ) {
      return { pmAgentRunId: (parsed as StartCtoValue).pmAgentRunId };
    }
    return null;
  } catch {
    return null;
  }
};

const parseStartBeValue = (raw: string): StartBeValue | null => {
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

const respondError = async ({
  respond,
  logger,
  step,
  error,
}: {
  respond: RespondFn;
  logger: Logger;
  step: 'PM' | 'CTO' | 'BE';
  error: unknown;
}): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`/auto-flow ${step} step 실패: ${message}`);
  await respond({
    response_type: 'ephemeral',
    replace_original: true,
    text: `auto-flow ${step} step 실패: ${message}`,
  });
};
