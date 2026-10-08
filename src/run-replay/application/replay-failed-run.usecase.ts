import { Injectable, Logger } from '@nestjs/common';

import { PublishNotionDraftUsecase } from '../../agent/blog/application/publish-notion-draft.usecase';
import { GenerateCeoMetaUsecase } from '../../agent/ceo/application/generate-ceo-meta.usecase';
import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { GenerateImpactReportUsecase } from '../../agent/impact-reporter/application/generate-impact-report.usecase';
import { GeneratePaperRecommendationUsecase } from '../../agent/paper-recommend/application/generate-paper-recommendation.usecase';
import { GenerateDailyPlanUsecase } from '../../agent/pm/application/generate-daily-plan.usecase';
import { GeneratePoEvaluationUsecase } from '../../agent/po-eval/application/generate-po-evaluation.usecase';
import { GeneratePoShadowUsecase } from '../../agent/po-shadow/application/generate-po-shadow.usecase';
import { WatchVideoUsecase } from '../../agent/video-watch/application/watch-video.usecase';
import { GenerateWorklogUsecase } from '../../agent/work-reviewer/application/generate-worklog.usecase';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { RetryRunUsecase } from '../../agent-run/application/retry-run.usecase';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { AgentRunRange } from '../../common/domain/agent-run-range.type';
import { PaperTradingPrismaRepository } from '../../paper-trading/infrastructure/paper-trading.prisma.repository';
import {
  ReplayRejection,
  ReplayRejectionCode,
} from '../domain/run-replay.type';

type OutcomeOf<Usecase extends { execute: (...args: never[]) => unknown }> =
  Awaited<ReturnType<Usecase['execute']>>;

/**
 * 판정을 통과한 재실행. `run()` 을 부르기 전에는 아무 부작용도 없다 — Slack 은 ack 뒤에,
 * 콘솔은 202 를 돌려준 뒤 백그라운드에서 부른다.
 *
 * 결과 모양이 agentType 마다 달라 판별 유니언으로 둔다. 결과를 글로 바꾸는 일(Slack 포맷)은
 * 전송 계층 몫이라 여기서 하지 않는다.
 */
export type PreparedReplay =
  | ReadyReplay<'PM', OutcomeOf<GenerateDailyPlanUsecase>>
  | ReadyReplay<'WORK_REVIEWER', OutcomeOf<GenerateWorklogUsecase>>
  | (ReadyReplay<'CODE_REVIEWER', OutcomeOf<ReviewPullRequestUsecase>> & {
      readonly prRef: string;
    })
  | ReadyReplay<'IMPACT_REPORTER', OutcomeOf<GenerateImpactReportUsecase>>
  | ReadyReplay<'PO_SHADOW', OutcomeOf<GeneratePoShadowUsecase>>
  | ReadyReplay<'PO_EVAL', OutcomeOf<GeneratePoEvaluationUsecase>>
  | ReadyReplay<'CEO', OutcomeOf<GenerateCeoMetaUsecase>>
  | (ReadyReplay<'VIDEO_WATCH', OutcomeOf<WatchVideoUsecase>> & {
      readonly videoId: string;
    })
  | (ReadyReplay<
      'PAPER_RECOMMEND',
      OutcomeOf<GeneratePaperRecommendationUsecase>
    > & { readonly strategy: 'LONG_TERM' | 'SWING' })
  | ReadyReplay<'BLOG_PUBLISH', OutcomeOf<PublishNotionDraftUsecase>>;

interface ReadyReplay<AgentType extends string, Result> {
  readonly kind: 'READY';
  readonly agentType: AgentType;
  readonly runId: number;
  readonly run: () => Promise<Result>;
}

export type ReplayPreparation = PreparedReplay | ReplayRejection;

/**
 * FAILED 실행을 같은 입력으로 다시 돌릴 수 있는지 판정하고, 돌릴 수 있으면 실행 함수를 내준다.
 *
 * Slack `/retry-run` 과 콘솔 `POST /v1/console/runs/:id/retry` 가 함께 쓴다. 입력 검증·소유자
 * 검사·agentType 별 디스패치·재시도 계보 연결이 모두 여기 있으므로 새 에이전트를 재실행 대상에
 * 넣을 때는 이 파일과 `REPLAYABLE_AGENT_TYPES` 만 고친다.
 */
@Injectable()
export class ReplayFailedRunUsecase {
  private readonly logger = new Logger(ReplayFailedRunUsecase.name);

  constructor(
    private readonly retryRunUsecase: RetryRunUsecase,
    private readonly generateDailyPlanUsecase: GenerateDailyPlanUsecase,
    private readonly generateWorklogUsecase: GenerateWorklogUsecase,
    private readonly reviewPullRequestUsecase: ReviewPullRequestUsecase,
    private readonly generateImpactReportUsecase: GenerateImpactReportUsecase,
    private readonly generatePoShadowUsecase: GeneratePoShadowUsecase,
    private readonly generatePoEvaluationUsecase: GeneratePoEvaluationUsecase,
    private readonly generateCeoMetaUsecase: GenerateCeoMetaUsecase,
    private readonly generatePaperRecommendationUsecase: GeneratePaperRecommendationUsecase,
    private readonly publishNotionDraftUsecase: PublishNotionDraftUsecase,
    private readonly paperTradingRepository: PaperTradingPrismaRepository,
    private readonly agentRunService: AgentRunService,
    private readonly watchVideoUsecase: WatchVideoUsecase,
  ) {}

  async prepare({
    runId,
    requesterSlackUserId,
  }: {
    runId: number;
    requesterSlackUserId: string;
  }): Promise<ReplayPreparation> {
    const payload = await this.retryRunUsecase.execute({ id: runId });
    if (!payload) {
      return reject(
        ReplayRejectionCode.NOT_FOUND,
        `run #${runId} 를 찾을 수 없거나 FAILED 상태가 아닙니다.`,
      );
    }

    // typed 후에도 runtime 형식 검증은 필수 — DB 의 JSON 이 우리 union 과 다른 형태일 수도.
    const rawSnapshot = payload.inputSnapshot as unknown;
    if (
      !rawSnapshot ||
      typeof rawSnapshot !== 'object' ||
      Array.isArray(rawSnapshot)
    ) {
      return reject(
        ReplayRejectionCode.INVALID_SNAPSHOT,
        `AgentRun #${runId} 의 inputSnapshot 형식이 올바르지 않아 재실행할 수 없습니다.`,
      );
    }
    const snapshot = payload.inputSnapshot;
    const originalUserId = snapshot.slackUserId;
    if (originalUserId && originalUserId !== requesterSlackUserId) {
      return reject(
        ReplayRejectionCode.FORBIDDEN,
        `AgentRun #${runId} 는 다른 사용자의 실행 기록이라 재실행할 수 없습니다.`,
      );
    }
    const slackUserId = originalUserId ?? requesterSlackUserId;
    const linked = <Outcome extends { agentRunId: number }>(
      execute: () => Promise<Outcome>,
    ): (() => Promise<Outcome>) => this.withLineage(runId, execute);

    switch (payload.agentType) {
      case 'PM':
        return ready(
          'PM',
          runId,
          linked(() =>
            this.generateDailyPlanUsecase.execute({
              tasksText: snapshot.tasksText ?? '',
              slackUserId,
              triggerType: TriggerType.FAILURE_REPLAY,
            }),
          ),
        );
      case 'WORK_REVIEWER':
        return ready(
          'WORK_REVIEWER',
          runId,
          linked(() =>
            this.generateWorklogUsecase.execute({
              workText: snapshot.workText ?? '',
              slackUserId,
            }),
          ),
        );
      case 'CODE_REVIEWER': {
        const prRef = snapshot.prRef ?? '';
        return {
          ...ready(
            'CODE_REVIEWER',
            runId,
            linked(() =>
              this.reviewPullRequestUsecase.execute({
                prRef,
                slackUserId,
                // 최초 실행이 게시하기로 했던 리뷰만 재실행에서도 게시한다.
                // 스냅샷에 키가 없는 스윕·연습 모드 실행은 종전대로 미게시.
                publish: snapshot.publish === true,
              }),
            ),
          ),
          prRef,
        };
      }
      case 'IMPACT_REPORTER':
        return ready(
          'IMPACT_REPORTER',
          runId,
          linked(() =>
            this.generateImpactReportUsecase.execute({
              subject: snapshot.subject ?? '',
              slackUserId,
            }),
          ),
        );
      case 'PO_SHADOW': {
        if ((snapshot.extraContextLength ?? 0) > 0) {
          return reject(
            ReplayRejectionCode.NOT_REPRODUCIBLE,
            `AgentRun #${runId} (PO_SHADOW) 는 추가 컨텍스트가 포함된 요청이라 정확히 재현할 수 없어 재실행을 지원하지 않습니다.`,
          );
        }
        return ready(
          'PO_SHADOW',
          runId,
          linked(() =>
            this.generatePoShadowUsecase.execute({
              extraContext: '',
              slackUserId,
            }),
          ),
        );
      }
      case 'PO_EVAL': {
        const range = toRange(snapshot.range);
        return ready(
          'PO_EVAL',
          runId,
          linked(() =>
            this.generatePoEvaluationUsecase.execute({ slackUserId, range }),
          ),
        );
      }
      case 'CEO': {
        const range = toRange(snapshot.range);
        return ready(
          'CEO',
          runId,
          linked(() =>
            this.generateCeoMetaUsecase.execute({ slackUserId, range }),
          ),
        );
      }
      case 'VACATION':
        return reject(
          ReplayRejectionCode.NOT_SUPPORTED,
          `AgentRun #${runId} (VACATION) 은 입력값에 의존하는 계산/기록이라 재실행을 지원하지 않습니다. \`/휴가\` 명령으로 다시 시도해주세요.`,
        );
      case 'DELAY_REPORT':
        return reject(
          ReplayRejectionCode.NOT_SUPPORTED,
          `AgentRun #${runId} (DELAY_REPORT) 는 실시간 조회라 재실행 개념이 없습니다. 현재 진행 현황을 다시 물어봐주세요.`,
        );
      // 실패는 대부분 다운로드 차단·codex 일시 실패라 같은 입력으로 다시 돌릴 가치가 있다.
      // 링크 원문은 저장하지 않으므로 검증된 videoId 로 요청 문장을 복원한다.
      case 'VIDEO_WATCH': {
        if (typeof snapshot.videoId !== 'string') {
          return reject(
            ReplayRejectionCode.NOT_REPRODUCIBLE,
            `AgentRun #${runId} (VIDEO_WATCH) 는 영상 정보가 남아 있지 않아 재실행할 수 없습니다. 영상 링크와 질문을 다시 멘션해 주세요.`,
          );
        }
        const videoId = snapshot.videoId;
        const question =
          typeof snapshot.question === 'string' ? snapshot.question : '';
        return {
          ...ready(
            'VIDEO_WATCH',
            runId,
            linked(() =>
              this.watchVideoUsecase.execute({
                slackUserId,
                text: `${question} https://www.youtube.com/watch?v=${videoId}`,
                triggerType: TriggerType.FAILURE_REPLAY,
              }),
            ),
          ),
          videoId,
        };
      }
      // 28일을 되짚는 누적 집계라 회차가 실패해도 데이터가 남지 않는다 — 다음 주 회차가
      // 같은 범위를 통째로 다시 본다. 지금 당장 수치를 봐야 하면 읽기 전용 스크립트가 있다.
      case 'BLOG_REVISION':
        return reject(
          ReplayRejectionCode.NOT_SUPPORTED,
          `AgentRun #${runId} (BLOG_REVISION) 은 28일을 되짚는 누적 집계라 회차 하나가 실패해도 다음 주 회차가 같은 범위를 다시 셉니다. 지금 수치를 확인하려면 \`node --env-file=.env -r ts-node/register/transpile-only scripts/blog-revision-report.ts\` 를 실행해주세요.`,
        );
      case 'PAPER_RECOMMEND':
        return await this.preparePaperRecommend(runId, snapshot);
      case 'BLOG':
        return reject(
          ReplayRejectionCode.NOT_SUPPORTED,
          `AgentRun #${runId} (BLOG) 은 Hermes 에이전트 실행이라 retry-run 을 지원하지 않습니다. 같은 요청을 자연어로 다시 멘션해주세요 (예: "@이대리 … 블로그 써줘").`,
        );
      case 'BLOG_PUBLISH':
        return ready(
          'BLOG_PUBLISH',
          runId,
          linked(() =>
            this.publishNotionDraftUsecase.execute({
              titleQuery: snapshot.titleQuery ?? '',
              pageId: snapshot.pageId,
              publishedAt: snapshot.publishedAt,
              slackUserId,
              triggerType: TriggerType.FAILURE_REPLAY,
            }),
          ),
        );
      case 'CAREER_MATE':
        return reject(
          ReplayRejectionCode.NOT_SUPPORTED,
          `AgentRun #${runId} (CAREER_MATE) 은 retry-run 대신 자연어로 다시 요청해주세요 (예: "@이대리 프로필 다시 정리해줘").`,
        );
      case 'JOB_APPLICATION':
        return reject(
          ReplayRejectionCode.NOT_SUPPORTED,
          `AgentRun #${runId} (JOB_APPLICATION) 은 입력 의존 기록이라 retry 미지원 — 자연어로 다시 말씀해주세요 (예: "@이대리 토스 서류 합격").`,
        );
      default:
        return reject(
          ReplayRejectionCode.UNKNOWN_AGENT_TYPE,
          `agentType '${payload.agentType}' 는 retry-run 이 지원되지 않습니다.`,
        );
    }
  }

  private async preparePaperRecommend(
    runId: number,
    snapshot: { strategy?: string; decidedAt?: string },
  ): Promise<ReplayPreparation> {
    const strategy = snapshot.strategy;
    const decidedAt = snapshot.decidedAt ? new Date(snapshot.decidedAt) : null;
    if (
      (strategy !== 'LONG_TERM' && strategy !== 'SWING') ||
      decidedAt === null ||
      Number.isNaN(decidedAt.getTime())
    ) {
      return reject(
        ReplayRejectionCode.NOT_REPRODUCIBLE,
        `AgentRun #${runId} (PAPER_RECOMMEND) 의 strategy 또는 decidedAt이 올바르지 않아 재실행할 수 없습니다.`,
      );
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
      return reject(
        ReplayRejectionCode.NOT_REPRODUCIBLE,
        `AgentRun #${runId} (PAPER_RECOMMEND) 은 이미 PENDING 주문을 남겨 중복 추천 방지를 위해 재실행할 수 없습니다.`,
      );
    }
    return {
      ...ready('PAPER_RECOMMEND', runId, async () => {
        const result = await this.generatePaperRecommendationUsecase.execute({
          strategies: [strategy],
          decidedAt,
          triggerType: TriggerType.FAILURE_REPLAY,
        });
        const completed = result.completed[0];
        if (completed) {
          await this.linkLineage(runId, completed.agentRunId);
        }
        return result;
      }),
      strategy,
    };
  }

  private withLineage<Outcome extends { agentRunId: number }>(
    originalRunId: number,
    execute: () => Promise<Outcome>,
  ): () => Promise<Outcome> {
    return async (): Promise<Outcome> => {
      const outcome = await execute();
      await this.linkLineage(originalRunId, outcome.agentRunId);
      return outcome;
    };
  }

  // 재시도로 만들어진 새 run 을 원본 FAILED run 의 자식으로 연결한다. 이렇게 해야 "이 실행은
  // 무엇의 재시도인가" 를 DB 만으로 재구성할 수 있다. 방향은 /auto-flow 와 동일 (부모=원본).
  // 부가 관측성이라 실패해도 삼킨다 — 재실행 결과 전달을 막으면 안 된다.
  private async linkLineage(
    originalRunId: number,
    agentRunId: number,
  ): Promise<void> {
    try {
      await this.agentRunService.setParentId({
        id: agentRunId,
        parentId: originalRunId,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `재시도 계보 연결 실패 run #${agentRunId} → #${originalRunId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

const reject = (
  code: ReplayRejectionCode,
  message: string,
): ReplayRejection => ({ kind: 'REJECTED', code, message });

const ready = <AgentType extends string, Result>(
  agentType: AgentType,
  runId: number,
  run: () => Promise<Result>,
): ReadyReplay<AgentType, Result> => ({
  kind: 'READY',
  agentType,
  runId,
  run,
});

const toRange = (range: string | undefined): AgentRunRange =>
  range === 'TODAY' ? 'TODAY' : 'WEEK';
