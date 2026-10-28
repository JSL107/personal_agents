import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  FORGOTTEN_GOAL_DAYS,
  MergedWork,
  planGoalCheckin,
} from '../../../agent/po-shadow/domain/goal-checkin';
import {
  GOAL_QUESTION_REPOSITORY_PORT,
  GOAL_QUESTION_TTL_MS,
  GoalQuestionRepositoryPort,
} from '../../../agent/po-shadow/domain/port/goal-question.repository.port';
import {
  PRODUCT_GOAL_REPOSITORY_PORT,
  ProductGoalRepositoryPort,
} from '../../../agent/po-shadow/domain/port/product-goal.repository.port';
import { ProductGoalPreviewPayload } from '../../../agent/po-shadow/domain/product-goal';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import {
  formatGoalCheckin,
  formatGoalClosePreview,
  GOAL_QUESTION_TEXT,
} from '../../../slack/format/product-goal.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const MILLISECONDS_PER_DAY = 86_400_000;
// 쉬기 판정에 필요한 만큼만 읽는다(planGoalCheckin 이 최근 2건을 본다).
const RECENT_QUESTION_LIMIT = 2;
// 2주 머지는 실측상 수십 건이다. 상한에 걸리면 오래된 쪽이 잘려 잊은 목표가 거짓으로 뜰 수 있다.
const MERGED_PULL_REQUEST_LIMIT = 100;
// 무반응 = 유지라서 다음 점검 전까지만 둔다.
const CLOSE_CARD_TTL_MS = 6 * MILLISECONDS_PER_DAY;

// 월요일 목표 점검(설계 2026-10-21 §4-1·§4-3). 목표가 없으면 묻고, 있으면 숙제 진척·잊은 목표·방향을 보여 준다.
@Injectable()
export class GoalCheckinAutopilotTask implements AutopilotTask {
  readonly id = 'goal-checkin';
  private readonly logger = new Logger(GoalCheckinAutopilotTask.name);

  constructor(
    @Inject(PRODUCT_GOAL_REPOSITORY_PORT)
    private readonly productGoalRepository: ProductGoalRepositoryPort,
    @Inject(GOAL_QUESTION_REPOSITORY_PORT)
    private readonly goalQuestionRepository: GoalQuestionRepositoryPort,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly configService: ConfigService,
  ) {}

  async run({
    ownerSlackUserId,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const now = new Date();
    const [goals, openQuestion, recentQuestions] = await Promise.all([
      this.productGoalRepository.findActive(ownerSlackUserId),
      this.goalQuestionRepository.findOpen({
        slackUserId: ownerSlackUserId,
        now,
      }),
      this.goalQuestionRepository.findRecent({
        slackUserId: ownerSlackUserId,
        limit: RECENT_QUESTION_LIMIT,
      }),
    ]);
    // 머지 이력은 숙제에만 쓴다 — 방향만 있으면 조회하지 않는다.
    const mergedPullRequests = goals.some((goal) => goal.kind === 'TASK')
      ? await this.fetchMergedOrNull(now)
      : [];
    const plan = planGoalCheckin({
      goals,
      mergedPullRequests,
      openQuestion,
      recentQuestions,
      now,
    });

    if (plan.kind === 'SKIP') {
      return { skip: true };
    }
    const asksQuestion =
      plan.kind === 'ASK_FOR_GOALS' || plan.drawOutDirection !== null;
    return {
      skip: false,
      summaryText:
        plan.kind === 'ASK_FOR_GOALS'
          ? GOAL_QUESTION_TEXT
          : formatGoalCheckin(plan),
      previews:
        plan.kind === 'CHECKIN'
          ? plan.staleGoals.map(({ goal }) => {
              const payload: ProductGoalPreviewPayload = {
                action: 'CLOSE',
                goalId: goal.id,
                title: goal.title,
              };
              return {
                kind: PREVIEW_KIND.PRODUCT_GOAL,
                payload,
                previewText: formatGoalClosePreview(goal),
                ttlMs: CLOSE_CARD_TTL_MS,
              };
            })
          : undefined,
      // 표지는 질문이 실제로 나간 뒤에만 남긴다 — 발송이 실패했는데 표지가 남으면 72시간 동안
      // 그 사용자의 평범한 DM 을 목표 답으로 가로챈다.
      onDelivered: asksQuestion
        ? async () => {
            await this.goalQuestionRepository.create({
              slackUserId: ownerSlackUserId,
              expiresAt: new Date(now.getTime() + GOAL_QUESTION_TTL_MS),
            });
          }
        : undefined,
    };
  }

  // PO 보고의 머지 조회와 같은 env 를 쓴다. author 미설정·조회 실패는 null — "작업 없음" 이 아니다.
  private async fetchMergedOrNull(now: Date): Promise<MergedWork[] | null> {
    const author = this.configService
      .get<string>('IMPACT_REPORT_GITHUB_AUTHOR')
      ?.trim();
    if (!author) {
      return null;
    }
    try {
      const pullRequests =
        await this.githubClient.listAuthorMergedPullRequestsSince({
          repo:
            this.configService
              .get<string>('IMPACT_REPORT_GITHUB_REPO')
              ?.trim() || null,
          author,
          sinceIsoDate: new Date(
            now.getTime() - FORGOTTEN_GOAL_DAYS * MILLISECONDS_PER_DAY,
          ).toISOString(),
          limit: MERGED_PULL_REQUEST_LIMIT,
          // 상세 조회가 일부만 실패해도 그 PR 이 목록에서 빠져 멀쩡한 숙제가 잊은 목표가 된다. 통째로 보류한다.
          throwOnDetailFailure: true,
        });
      return pullRequests.flatMap(({ number, title, mergedAt }) =>
        mergedAt === null ? [] : [{ number, title, mergedAt }],
      );
    } catch (error: unknown) {
      this.logger.warn(
        `목표 점검 머지 PR 조회 실패 (관련 작업 없이 계속): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
