import { Injectable, Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { GenerateBackendPlanUsecase } from '../../agent/be/application/generate-backend-plan.usecase';
import { AnalyzePrConventionUsecase } from '../../agent/be-fix/application/analyze-pr-convention.usecase';
import { GenerateSchemaProposalUsecase } from '../../agent/be-schema/application/generate-schema-proposal.usecase';
import { AnalyzeStackTraceUsecase } from '../../agent/be-sre/application/analyze-stack-trace.usecase';
import { GenerateTestUsecase } from '../../agent/be-test/application/generate-test.usecase';
import { PublishNotionDraftUsecase } from '../../agent/blog/application/publish-notion-draft.usecase';
import { GenerateCeoMetaUsecase } from '../../agent/ceo/application/generate-ceo-meta.usecase';
import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { GenerateAssignmentUsecase } from '../../agent/cto/application/generate-assignment.usecase';
import { GenerateImpactReportUsecase } from '../../agent/impact-reporter/application/generate-impact-report.usecase';
import { GeneratePaperRecommendationUsecase } from '../../agent/paper-recommend/application/generate-paper-recommendation.usecase';
import { GenerateDailyPlanUsecase } from '../../agent/pm/application/generate-daily-plan.usecase';
import { GeneratePoEvaluationUsecase } from '../../agent/po-eval/application/generate-po-evaluation.usecase';
import { GeneratePoShadowUsecase } from '../../agent/po-shadow/application/generate-po-shadow.usecase';
import { GenerateWorklogUsecase } from '../../agent/work-reviewer/application/generate-worklog.usecase';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { RetryRunUsecase } from '../../agent-run/application/retry-run.usecase';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { AgentRunRange } from '../../common/domain/agent-run-range.type';
import { HumanizeService } from '../../humanize/application/humanize.service';
import {
  humanizeAssignmentOutput,
  humanizeBackendPlan,
  humanizeEvaluationOutput,
} from '../../humanize/application/humanize-report.adapter';
import { PaperTradingPrismaRepository } from '../../paper-trading/infrastructure/paper-trading.prisma.repository';
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
import { respondBlogPublishOutcome } from './blog-publish.handler';
import {
  runAgentCommand,
  runEphemeral,
  toUserFacingErrorMessage,
} from './slack-handler.helper';

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
    private readonly generatePaperRecommendationUsecase: GeneratePaperRecommendationUsecase,
    private readonly publishNotionDraftUsecase: PublishNotionDraftUsecase,
    private readonly paperTradingRepository: PaperTradingPrismaRepository,
    private readonly agentRunService: AgentRunService,
    private readonly humanizeService: HumanizeService,
  ) {}

  // 재시도로 만들어진 새 run 을 원본 FAILED run 의 자식으로 연결한다. 이렇게 해야 "이 실행은
  // 무엇의 재시도인가" 를 DB 만으로 재구성할 수 있다. 방향은 /auto-flow 와 동일 (부모=원본).
  // 반환 타입의 파라미터를 좁은 구조로 둬서 agentType 별 result 타입과 무관하게 재사용한다.
  private linkRetryLineage(
    originalRunId: number,
  ): (outcome: { agentRunId: number }) => Promise<void> {
    return async (outcome: { agentRunId: number }): Promise<void> => {
      await this.agentRunService.setParentId({
        id: outcome.agentRunId,
        parentId: originalRunId,
      });
    };
  }

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
            onOutcome: this.linkRetryLineage(id),
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
            onOutcome: this.linkRetryLineage(id),
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
                // 최초 실행이 게시하기로 했던 리뷰만 재실행에서도 게시한다.
                // 스냅샷에 키가 없는 스윕·연습 모드 실행은 종전대로 미게시.
                publish: snapshot.publish === true,
              }),
            format: (review) =>
              formatPullRequestReview({
                prRef: snapshot.prRef ?? '',
                review,
              }),
            onOutcome: this.linkRetryLineage(id),
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
            onOutcome: this.linkRetryLineage(id),
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
            format: async (result) => {
              const humanized = await humanizeBackendPlan(
                result,
                this.humanizeService,
              );
              return formatBackendPlan(humanized);
            },
            onOutcome: this.linkRetryLineage(id),
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
            onOutcome: this.linkRetryLineage(id),
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
            onOutcome: this.linkRetryLineage(id),
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
            onOutcome: this.linkRetryLineage(id),
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
            onOutcome: this.linkRetryLineage(id),
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
            onOutcome: this.linkRetryLineage(id),
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
            format: async (result) => {
              const humanized = await humanizeAssignmentOutput(
                result,
                this.humanizeService,
              );
              return formatAssignmentOutput(humanized);
            },
            onOutcome: this.linkRetryLineage(id),
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
            format: async (result) => {
              const humanized = await humanizeEvaluationOutput(
                result,
                this.humanizeService,
              );
              return formatEvaluationOutput(humanized);
            },
            onOutcome: this.linkRetryLineage(id),
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
            onOutcome: this.linkRetryLineage(id),
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
        case 'PAPER_RECOMMEND': {
          const strategy = snapshot.strategy;
          const decidedAt = snapshot.decidedAt
            ? new Date(snapshot.decidedAt)
            : null;
          if (
            (strategy !== 'LONG_TERM' && strategy !== 'SWING') ||
            decidedAt === null ||
            Number.isNaN(decidedAt.getTime())
          ) {
            await respond({
              response_type: 'ephemeral',
              replace_original: true,
              text: `AgentRun #${id} (PAPER_RECOMMEND) 의 strategy 또는 decidedAt이 올바르지 않아 재실행할 수 없습니다.`,
            });
            return;
          }
          const account =
            await this.paperTradingRepository.findAccountByName(strategy);
          if (
            account &&
            (await this.paperTradingRepository.hasOrdersForRecommendation({
              accountId: account.id,
              strategy,
              decidedAt,
            }))
          ) {
            await respond({
              response_type: 'ephemeral',
              replace_original: true,
              text: `AgentRun #${id} (PAPER_RECOMMEND) 은 이미 PENDING 주문을 남겨 중복 추천 방지를 위해 재실행할 수 없습니다.`,
            });
            return;
          }
          await runEphemeral({
            respond,
            logger: this.logger,
            commandLabel: `/retry-run#${id} (PAPER_RECOMMEND)`,
            task: async () => {
              const result =
                await this.generatePaperRecommendationUsecase.execute({
                  strategies: [strategy],
                  decidedAt,
                  triggerType: TriggerType.FAILURE_REPLAY,
                });
              const completed = result.completed[0];
              if (completed) {
                await this.linkRetryLineage(id)({
                  agentRunId: completed.agentRunId,
                });
              }
              return result;
            },
            format: (result) => {
              const completed = result.completed[0];
              if (completed) {
                return `${completed.strategy} 추천 재실행 완료: PENDING 주문 ${completed.ordersCreated}건`;
              }
              return `${strategy} 추천 재실행 실패: ${result.failed[0]?.message ?? '알 수 없는 오류'}`;
            },
          });
          break;
        }
        case 'BLOG': {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `AgentRun #${id} (BLOG) 은 Hermes 에이전트 실행이라 retry-run 을 지원하지 않습니다. 같은 요청을 자연어로 다시 멘션해주세요 (예: "@이대리 … 블로그 써줘").`,
          });
          return;
        }
        case 'BLOG_PUBLISH': {
          const commandLabel = `/retry-run#${id} (BLOG_PUBLISH)`;
          try {
            const outcome = await this.publishNotionDraftUsecase.execute({
              titleQuery: snapshot.titleQuery ?? '',
              pageId: snapshot.pageId,
              slackUserId,
              triggerType: TriggerType.FAILURE_REPLAY,
            });
            await respondBlogPublishOutcome(respond, outcome);
            try {
              await this.linkRetryLineage(id)(outcome);
            } catch (error: unknown) {
              this.logger.warn(
                `${commandLabel} 실행 후처리 실패 (응답은 정상 전달됨): ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          } catch (error: unknown) {
            const rawMessage =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `${commandLabel} 실패: ${rawMessage}`,
              error instanceof Error ? error.stack : undefined,
            );
            await respond({
              response_type: 'ephemeral',
              replace_original: true,
              text: `이대리 ${commandLabel} 실패: ${toUserFacingErrorMessage(error)}`,
            });
          }
          break;
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
