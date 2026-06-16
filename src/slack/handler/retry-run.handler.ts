import { Injectable, Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { GenerateBackendPlanUsecase } from '../../agent/be/application/generate-backend-plan.usecase';
import { AnalyzePrConventionUsecase } from '../../agent/be-fix/application/analyze-pr-convention.usecase';
import { GenerateSchemaProposalUsecase } from '../../agent/be-schema/application/generate-schema-proposal.usecase';
import { AnalyzeStackTraceUsecase } from '../../agent/be-sre/application/analyze-stack-trace.usecase';
import { GenerateTestUsecase } from '../../agent/be-test/application/generate-test.usecase';
import { GenerateCeoMetaUsecase } from '../../agent/ceo/application/generate-ceo-meta.usecase';
import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { GenerateAssignmentUsecase } from '../../agent/cto/application/generate-assignment.usecase';
import { GenerateImpactReportUsecase } from '../../agent/impact-reporter/application/generate-impact-report.usecase';
import { GenerateDailyPlanUsecase } from '../../agent/pm/application/generate-daily-plan.usecase';
import { GeneratePoEvaluationUsecase } from '../../agent/po-eval/application/generate-po-evaluation.usecase';
import { GeneratePoShadowUsecase } from '../../agent/po-shadow/application/generate-po-shadow.usecase';
import { GenerateWorklogUsecase } from '../../agent/work-reviewer/application/generate-worklog.usecase';
import { RetryRunUsecase } from '../../agent-run/application/retry-run.usecase';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { AgentRunRange } from '../../common/domain/agent-run-range.type';
import { SlackHandler } from '../domain/port/slack-handler.port';
import { formatAssignmentOutput } from '../format/assignment.formatter';
import { formatBackendPlan } from '../format/backend-plan.formatter';
import { formatPrConventionReport } from '../format/be-fix.formatter';
import { formatSchemaProposal } from '../format/be-schema.formatter';
import { formatSreAnalysis } from '../format/be-sre.formatter';
import { formatGeneratedTest } from '../format/be-test.formatter';
import { formatCeoMetaOutput } from '../format/ceo-meta.formatter';
import { formatDailyPlan } from '../format/daily-plan.formatter';
import { formatDailyReview } from '../format/daily-review.formatter';
import { formatImpactReport } from '../format/impact-report.formatter';
import { formatEvaluationOutput } from '../format/po-evaluation.formatter';
import { formatPoShadowReport } from '../format/po-shadow.formatter';
import { formatPullRequestReview } from '../format/pull-request-review.formatter';
import { runAgentCommand } from './slack-handler.helper';

// /retry-run — FAILED AgentRun 의 inputSnapshot 으로 동일 작업을 재실행 (OPS-5).
// 본인 명의의 run 만 가능, agentType 별로 적합한 usecase 로 라우팅.
// agent-command.handler 가 비대해져 (488 LOC) retry-run switch 부분만 분리 (V3 audit P2).
//
// C-4 Phase 9 — registerRetryRunHandler fn → @Injectable() class.
@Injectable()
export class RetryRunHandler implements SlackHandler {
  private readonly logger = new Logger(RetryRunHandler.name);

  constructor(
    private readonly retryRunUsecase: RetryRunUsecase,
    private readonly generateDailyPlanUsecase: GenerateDailyPlanUsecase,
    private readonly generateWorklogUsecase: GenerateWorklogUsecase,
    private readonly reviewPullRequestUsecase: ReviewPullRequestUsecase,
    private readonly generateImpactReportUsecase: GenerateImpactReportUsecase,
    private readonly generateBackendPlanUsecase: GenerateBackendPlanUsecase,
    private readonly generatePoShadowUsecase: GeneratePoShadowUsecase,
    private readonly generateSchemaProposalUsecase: GenerateSchemaProposalUsecase,
    private readonly generateTestUsecase: GenerateTestUsecase,
    private readonly analyzeStackTraceUsecase: AnalyzeStackTraceUsecase,
    private readonly analyzePrConventionUsecase: AnalyzePrConventionUsecase,
    private readonly generateAssignmentUsecase: GenerateAssignmentUsecase,
    private readonly generatePoEvaluationUsecase: GeneratePoEvaluationUsecase,
    private readonly generateCeoMetaUsecase: GenerateCeoMetaUsecase,
  ) {}

  register(app: App): void {
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

      const payload = await this.retryRunUsecase.execute({ id });
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
            logger: this.logger,
            commandLabel: '/retry-run(PM)',
            execute: () =>
              this.generateDailyPlanUsecase.execute({
                tasksText: snapshot.tasksText ?? '',
                slackUserId,
                triggerType: TriggerType.FAILURE_REPLAY,
              }),
            format: (result) => formatDailyPlan(result.plan),
          });
          break;
        case 'WORK_REVIEWER':
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: '/retry-run(WORK_REVIEWER)',
            execute: () =>
              this.generateWorklogUsecase.execute({
                workText: snapshot.workText ?? '',
                slackUserId,
              }),
            format: formatDailyReview,
          });
          break;
        case 'CODE_REVIEWER':
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: '/retry-run(CODE_REVIEWER)',
            execute: () =>
              this.reviewPullRequestUsecase.execute({
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
            logger: this.logger,
            commandLabel: '/retry-run(IMPACT_REPORTER)',
            execute: () =>
              this.generateImpactReportUsecase.execute({
                subject: snapshot.subject ?? '',
                slackUserId,
              }),
            format: formatImpactReport,
          });
          break;
        case 'BE':
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: `/retry-run#${id} (BE)`,
            execute: () =>
              this.generateBackendPlanUsecase.execute({
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
            logger: this.logger,
            commandLabel: `/retry-run#${id} (PO_SHADOW)`,
            execute: () =>
              this.generatePoShadowUsecase.execute({
                extraContext: '',
                slackUserId,
              }),
            format: formatPoShadowReport,
          });
          break;
        }
        case 'BE_SCHEMA':
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: `/retry-run#${id} (BE_SCHEMA)`,
            execute: () =>
              this.generateSchemaProposalUsecase.execute({
                request: snapshot.request ?? '',
                slackUserId,
                triggerType: TriggerType.FAILURE_REPLAY,
              }),
            format: formatSchemaProposal,
          });
          break;
        case 'BE_TEST':
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: `/retry-run#${id} (BE_TEST)`,
            execute: () =>
              this.generateTestUsecase.execute({
                filePath: snapshot.filePath ?? '',
                slackUserId,
                triggerType: TriggerType.FAILURE_REPLAY,
              }),
            format: formatGeneratedTest,
          });
          break;
        case 'BE_SRE':
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: `/retry-run#${id} (BE_SRE)`,
            execute: () =>
              this.analyzeStackTraceUsecase.execute({
                stackTrace: snapshot.stackTrace ?? '',
                slackUserId,
                triggerType: TriggerType.FAILURE_REPLAY,
              }),
            format: formatSreAnalysis,
          });
          break;
        case 'BE_FIX':
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: `/retry-run#${id} (BE_FIX)`,
            execute: () =>
              this.analyzePrConventionUsecase.execute({
                prRef: snapshot.prRef ?? '',
                slackUserId,
                triggerType: TriggerType.FAILURE_REPLAY,
              }),
            format: formatPrConventionReport,
          });
          break;
        case 'CTO':
          // CTO 의 retry — usecase 가 자동 조회 (직전 PM run) 기반. snapshot.dailyPlanAgentRunId
          // 는 inputSnapshot 에 기록되어 있지만 명시 지정 분배는 본 step 미지원 (warn fallback).
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: `/retry-run#${id} (CTO)`,
            execute: () =>
              this.generateAssignmentUsecase.execute({
                slackUserId,
                dailyPlanAgentRunId: snapshot.dailyPlanAgentRunId,
              }),
            format: formatAssignmentOutput,
          });
          break;
        case 'PO_EVAL': {
          const range: AgentRunRange =
            snapshot.range === 'TODAY' ? 'TODAY' : 'WEEK';
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: `/retry-run#${id} (PO_EVAL)`,
            execute: () =>
              this.generatePoEvaluationUsecase.execute({
                slackUserId,
                range,
              }),
            format: formatEvaluationOutput,
          });
          break;
        }
        case 'CEO': {
          const range: AgentRunRange =
            snapshot.range === 'TODAY' ? 'TODAY' : 'WEEK';
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: `/retry-run#${id} (CEO)`,
            execute: () =>
              this.generateCeoMetaUsecase.execute({
                slackUserId,
                range,
              }),
            format: formatCeoMetaOutput,
          });
          break;
        }
        case 'VACATION': {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `AgentRun #${id} (VACATION) 은 입력값에 의존하는 계산/기록이라 재실행을 지원하지 않습니다. \`/휴가\` 명령으로 다시 시도해주세요.`,
          });
          return;
        }
        case 'BLOG': {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `AgentRun #${id} (BLOG) 은 Hermes 에이전트 실행이라 retry-run 을 지원하지 않습니다. 같은 요청을 자연어로 다시 멘션해주세요 (예: "@이대리 … 블로그 써줘").`,
          });
          return;
        }
        case 'CAREER_MATE': {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `AgentRun #${id} (CAREER_MATE) 은 retry-run 대신 자연어로 다시 요청해주세요 (예: "@이대리 프로필 다시 정리해줘").`,
          });
          return;
        }
        case 'JOB_APPLICATION': {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `AgentRun #${id} (JOB_APPLICATION) 은 입력 의존 기록이라 retry 미지원 — 자연어로 다시 말씀해주세요 (예: "@이대리 토스 서류 합격").`,
          });
          return;
        }
        default:
          await respond({
            response_type: 'ephemeral',
            text: `agentType '${payload.agentType}' 는 retry-run 이 지원되지 않습니다.`,
          });
      }
    });
  }
}
