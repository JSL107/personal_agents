import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { GenerateBackendPlanUsecase } from '../../agent/be/application/generate-backend-plan.usecase';
import { GenerateSchemaProposalUsecase } from '../../agent/be-schema/application/generate-schema-proposal.usecase';
import { GenerateAssignmentUsecase } from '../../agent/cto/application/generate-assignment.usecase';
import { Assignment, BeAssignmentType } from '../../agent/cto/domain/cto.type';
import { GenerateDailyPlanUsecase } from '../../agent/pm/application/generate-daily-plan.usecase';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { AgentType } from '../../model-router/domain/model-router.type';

// V3 비전 phase loop chain — `/auto-flow` 슬래시.
// 사용자 명시 트리거 1회로 P1 (PM plan) → P2 (CTO 분배) → P3 (BE worker per assignment) chain.
// 각 step 의 AgentRun 은 parentId 로 chain 추적 (audit log).
//
// Phase 1 (본 PR): minimal chain — PreviewGate 안전판 없이 사용자 명시 트리거만으로 진행.
// Phase 2 (후속 plan): 각 step 사이 PreviewGate 사용자 confirm 안전판 도입.
//
// chain 범위:
//   - PM: tasksText 전달 (자유 텍스트 옵션).
//   - CTO: 직전 PM run 자동 조회 (assignableTaskIds 0 면 chain 중단 + 안내).
//   - BE worker: assignment 별로 GenerateBackendPlanUsecase / GenerateSchemaProposalUsecase 호출.
//     BE_TEST 는 filePath 인자 필요라 본 chain 미지원 (skip + 안내).
//
// 응답 방식: respond({ replace_original: true }) 로 progress 갱신, 최종 step 의 답글에 전체 결과 요약.

export interface AutoFlowHandlerDeps {
  generateDailyPlanUsecase: GenerateDailyPlanUsecase;
  generateAssignmentUsecase: GenerateAssignmentUsecase;
  generateBackendPlanUsecase: GenerateBackendPlanUsecase;
  generateSchemaProposalUsecase: GenerateSchemaProposalUsecase;
  agentRunService: AgentRunService;
  logger: Logger;
}

interface BeChainOutcome {
  assignment: Assignment;
  status: 'OK' | 'SKIPPED' | 'FAILED';
  agentRunId?: number;
  message: string;
}

export const registerAutoFlowHandler = (
  app: App,
  deps: AutoFlowHandlerDeps,
): void => {
  app.command('/auto-flow', async ({ ack, command, respond }) => {
    const tasksText = command.text?.trim() ?? '';
    await ack({
      response_type: 'ephemeral',
      text: 'auto-flow 시작 — PM → CTO → BE chain 진행 중입니다 (1~3분 소요)...',
    });

    try {
      // step 1: PM plan
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: '[1/3] PM plan 작성 중...',
      });
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
          text: `[1/3] PM plan 완료 (#${pmOutcome.agentRunId}). 그러나 assignableTaskIds 가 비어 있어 분배 대상이 없습니다. chain 중단.`,
        });
        return;
      }

      // step 2: CTO 분배
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `[2/3] PM 완료 (#${pmOutcome.agentRunId}). CTO 분배 (${assignableTaskIds.length} task) 진행 중...`,
      });
      const ctoOutcome = await deps.generateAssignmentUsecase.execute({
        slackUserId: command.user_id,
      });
      await deps.agentRunService.setParentId({
        id: ctoOutcome.agentRunId,
        parentId: pmOutcome.agentRunId,
      });

      const assignments = ctoOutcome.result.assignments;
      if (assignments.length === 0) {
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `[2/3] CTO 분배 완료 (#${ctoOutcome.agentRunId}) — 자동 분배 가능 assignment 가 없어 BE chain skip.\n\n${ctoOutcome.result.ctoSummary}`,
        });
        return;
      }

      // step 3: BE worker chain
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `[3/3] CTO 완료 (#${ctoOutcome.agentRunId}). BE chain 진행 중 (${assignments.length} worker)...`,
      });
      const beOutcomes: BeChainOutcome[] = [];
      for (const assignment of assignments) {
        const outcome = await runBeWorker({
          assignment,
          slackUserId: command.user_id,
          parentRunId: ctoOutcome.agentRunId,
          deps,
        });
        beOutcomes.push(outcome);
      }

      const finalText = formatChainResult({
        pmAgentRunId: pmOutcome.agentRunId,
        ctoOutcome,
        beOutcomes,
      });
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: finalText,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logger.error(`/auto-flow chain 실패: ${message}`);
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `auto-flow chain 실패: ${message}`,
      });
    }
  });
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
    return {
      assignment,
      status: 'SKIPPED',
      message:
        'BE_TEST 는 filePath 인자 필요라 auto-flow chain 미지원 (사용자가 별도 `/be-test` 호출).',
    };
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
    // 미지원 BeAssignmentType — type 상 위 3 종 외 도달 불가지만 graceful.
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

const formatChainResult = ({
  pmAgentRunId,
  ctoOutcome,
  beOutcomes,
}: {
  pmAgentRunId: number;
  ctoOutcome: { agentRunId: number; result: { ctoSummary: string } };
  beOutcomes: BeChainOutcome[];
}): string => {
  const lines: string[] = ['*🔁 auto-flow chain 완료*'];
  lines.push('');
  lines.push(`*[P1 PM plan]* #${pmAgentRunId} — \`/today\` 결과 참조.`);
  lines.push('');
  lines.push(`*[P2 CTO 분배]* #${ctoOutcome.agentRunId}`);
  if (ctoOutcome.result.ctoSummary.trim().length > 0) {
    lines.push(`_${ctoOutcome.result.ctoSummary}_`);
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
    '_각 worker run id 로 `/retry-run <id>` 가능. chain audit 은 AgentRun.parentId 로._',
  );
  return lines.join('\n');
};
