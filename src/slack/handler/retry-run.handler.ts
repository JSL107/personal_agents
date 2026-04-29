import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { GenerateBackendPlanUsecase } from '../../agent/be/application/generate-backend-plan.usecase';
import { GenerateSchemaProposalUsecase } from '../../agent/be-schema/application/generate-schema-proposal.usecase';
import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { GenerateImpactReportUsecase } from '../../agent/impact-reporter/application/generate-impact-report.usecase';
import { GenerateDailyPlanUsecase } from '../../agent/pm/application/generate-daily-plan.usecase';
import { GeneratePoOutlineUsecase } from '../../agent/po-expand/application/generate-po-outline.usecase';
import { GeneratePoShadowUsecase } from '../../agent/po-shadow/application/generate-po-shadow.usecase';
import { GenerateWorklogUsecase } from '../../agent/work-reviewer/application/generate-worklog.usecase';
import { RetryRunUsecase } from '../../agent-run/application/retry-run.usecase';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { formatBackendPlan } from '../format/backend-plan.formatter';
import { formatSchemaProposal } from '../format/be-schema.formatter';
import { formatDailyPlan } from '../format/daily-plan.formatter';
import { formatDailyReview } from '../format/daily-review.formatter';
import { formatImpactReport } from '../format/impact-report.formatter';
import { formatPoOutline } from '../format/po-outline.formatter';
import { formatPoShadowReport } from '../format/po-shadow.formatter';
import { formatPullRequestReview } from '../format/pull-request-review.formatter';
import { runAgentCommand } from './slack-handler.helper';

// /retry-run — FAILED AgentRun 의 inputSnapshot 으로 동일 작업을 재실행 (OPS-5).
// 본인 명의의 run 만 가능, agentType 별로 적합한 usecase 로 라우팅.
// agent-command.handler 가 비대해져 (488 LOC) retry-run switch 부분만 분리 (V3 audit P2).
export interface RetryRunHandlerDeps {
  retryRunUsecase: RetryRunUsecase;
  generateDailyPlanUsecase: GenerateDailyPlanUsecase;
  generateWorklogUsecase: GenerateWorklogUsecase;
  reviewPullRequestUsecase: ReviewPullRequestUsecase;
  generateImpactReportUsecase: GenerateImpactReportUsecase;
  generateBackendPlanUsecase: GenerateBackendPlanUsecase;
  generatePoShadowUsecase: GeneratePoShadowUsecase;
  generatePoOutlineUsecase: GeneratePoOutlineUsecase;
  generateSchemaProposalUsecase: GenerateSchemaProposalUsecase;
  logger: Logger;
}

export const registerRetryRunHandler = (
  app: App,
  deps: RetryRunHandlerDeps,
): void => {
  app.command('/retry-run', async ({ ack, command, respond }) => {
    const idText = command.text?.trim() ?? '';
    const id = Number(idText);
    if (!idText || !Number.isInteger(id) || id <= 0) {
      await ack({
        response_type: 'ephemeral',
        text: '사용법: `/retry-run <id>` (예: `/retry-run 42`)',
      });
      return;
    }
    await ack({
      response_type: 'ephemeral',
      text: `이대리가 run #${id} 를 재실행하는 중입니다...`,
    });

    const payload = await deps.retryRunUsecase.execute({ id });
    if (!payload) {
      await respond({
        response_type: 'ephemeral',
        text: `run #${id} 를 찾을 수 없거나 FAILED 상태가 아닙니다.`,
      });
      return;
    }

    // typed 후에도 runtime 형식 검증은 필수 — DB 의 JSON 이 우리 union 과 다른 형태일 수도.
    const rawSnapshot = payload.inputSnapshot as unknown;
    if (
      !rawSnapshot ||
      typeof rawSnapshot !== 'object' ||
      Array.isArray(rawSnapshot)
    ) {
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `AgentRun #${id} 의 inputSnapshot 형식이 올바르지 않아 재실행할 수 없습니다.`,
      });
      return;
    }
    const snapshot = payload.inputSnapshot;
    const originalUserId = snapshot.slackUserId;
    if (originalUserId && originalUserId !== command.user_id) {
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `AgentRun #${id} 는 다른 사용자의 실행 기록이라 재실행할 수 없습니다.`,
      });
      return;
    }
    const slackUserId = originalUserId ?? command.user_id;

    switch (payload.agentType) {
      case 'PM':
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: '/retry-run(PM)',
          execute: () =>
            deps.generateDailyPlanUsecase.execute({
              tasksText: snapshot.tasksText ?? '',
              slackUserId,
              triggerType: TriggerType.FAILURE_REPLAY,
            }),
          format: (result) => formatDailyPlan(result.plan, result.sources),
        });
        break;
      case 'WORK_REVIEWER':
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: '/retry-run(WORK_REVIEWER)',
          execute: () =>
            deps.generateWorklogUsecase.execute({
              workText: snapshot.workText ?? '',
              slackUserId,
            }),
          format: formatDailyReview,
        });
        break;
      case 'CODE_REVIEWER':
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: '/retry-run(CODE_REVIEWER)',
          execute: () =>
            deps.reviewPullRequestUsecase.execute({
              prRef: snapshot.prRef ?? '',
              slackUserId,
            }),
          format: (review) =>
            formatPullRequestReview({
              prRef: snapshot.prRef ?? '',
              review,
            }),
        });
        break;
      case 'IMPACT_REPORTER':
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: '/retry-run(IMPACT_REPORTER)',
          execute: () =>
            deps.generateImpactReportUsecase.execute({
              subject: snapshot.subject ?? '',
              slackUserId,
            }),
          format: formatImpactReport,
        });
        break;
      case 'BE':
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: `/retry-run#${id} (BE)`,
          execute: () =>
            deps.generateBackendPlanUsecase.execute({
              subject: snapshot.subject ?? '',
              slackUserId,
            }),
          format: formatBackendPlan,
        });
        break;
      case 'PO_SHADOW': {
        const origLen = snapshot.extraContextLength ?? 0;
        if (origLen > 0) {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `AgentRun #${id} (PO_SHADOW) 는 추가 컨텍스트가 포함된 요청이라 정확히 재현할 수 없어 재실행을 지원하지 않습니다.`,
          });
          return;
        }
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: `/retry-run#${id} (PO_SHADOW)`,
          execute: () =>
            deps.generatePoShadowUsecase.execute({
              extraContext: '',
              slackUserId,
            }),
          format: formatPoShadowReport,
        });
        break;
      }
      case 'PO_EXPAND':
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: `/retry-run#${id} (PO_EXPAND)`,
          execute: () =>
            deps.generatePoOutlineUsecase.execute({
              subject: snapshot.subject ?? '',
              slackUserId,
              triggerType: TriggerType.FAILURE_REPLAY,
            }),
          format: formatPoOutline,
        });
        break;
      case 'BE_SCHEMA':
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: `/retry-run#${id} (BE_SCHEMA)`,
          execute: () =>
            deps.generateSchemaProposalUsecase.execute({
              request: snapshot.request ?? '',
              slackUserId,
              triggerType: TriggerType.FAILURE_REPLAY,
            }),
          format: formatSchemaProposal,
        });
        break;
      default:
        await respond({
          response_type: 'ephemeral',
          text: `agentType '${payload.agentType}' 는 retry-run 이 지원되지 않습니다.`,
        });
    }
  });
};
