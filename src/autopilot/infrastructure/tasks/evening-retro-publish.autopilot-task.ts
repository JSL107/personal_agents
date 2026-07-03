import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  buildEveningRetroPrompt,
  EVENING_RETRO_SYSTEM_PROMPT,
  EveningPrInput,
  parseEveningRetroOutput,
} from '../../../agent/blog/domain/prompt/evening-retro.prompt';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import {
  AutopilotPreviewRequest,
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const RETRO_PR_LIMIT = 20;

// 저녁 회고→발행 후보 — evening 그룹(19:00 KST), daily-eval/work-reviewer 뒤 순서.
// 오늘 머지 PR + 오늘 WORK_REVIEWER/PO_EVAL run 을 재조회해 codex 로 1회 회고→후보 JSON.
// 발송은 orchestrator(T1_PREVIEW) — 여기선 텍스트 + previews 만 만든다.
@Injectable()
export class EveningRetroPublishTask implements AutopilotTask {
  readonly id = 'evening-retro-publish';
  private readonly logger = new Logger(EveningRetroPublishTask.name);

  constructor(
    private readonly agentRunService: AgentRunService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly modelRouter: ModelRouterUsecase,
    private readonly config: ConfigService,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    if (this.config.get<string>('EVENING_RETRO_PUBLISH_ENABLED') === 'false') {
      return { skip: true };
    }

    const author = this.config.get<string>('IMPACT_REPORT_GITHUB_AUTHOR');
    const sinceIsoDate = new Date().toISOString().slice(0, 10);
    const mergedPrs: EveningPrInput[] = author
      ? (
          await this.githubClient.listAuthorMergedPullRequestsSince({
            repo: null,
            author,
            sinceIsoDate,
            limit: RETRO_PR_LIMIT,
          })
        ).map((pr) => ({
          repo: pr.repo,
          number: pr.number,
          url: pr.url,
          title: pr.title,
          body: pr.body,
        }))
      : [];

    const worklogText = await this.readRunText(
      AgentType.WORK_REVIEWER,
      ownerSlackUserId,
    );
    const dailyEvalText = await this.readRunText(
      AgentType.PO_EVAL,
      ownerSlackUserId,
    );

    if (mergedPrs.length === 0 && !worklogText && !dailyEvalText) {
      return { skip: true };
    }

    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.EVENING_RETRO,
        request: {
          prompt: buildEveningRetroPrompt({
            mergedPrs,
            worklogText,
            dailyEvalText,
          }),
          systemPrompt: EVENING_RETRO_SYSTEM_PROMPT,
        },
      });
      const parsed = parseEveningRetroOutput(completion.text);

      const scoreLines = parsed.candidates
        .map(
          (candidate) =>
            `• (${candidate.blogValueScore}점) ${candidate.title} — ${candidate.keywords.join(', ')}`,
        )
        .join('\n');
      const summaryText = `🌙 *오늘의 회고 & 발행 후보 — ${firedAtKst}*\n\n${parsed.retrospective}\n\n*발행 후보(가치 점수)*\n${scoreLines || '_후보 없음_'}`;

      const previews: AutopilotPreviewRequest[] = [];
      // 블로그 카드 — 대표(최고점) 후보 기준. candidates 있을 때만.
      const top = parsed.candidates[0];
      if (top) {
        previews.push({
          kind: PREVIEW_KIND.EVENING_BLOG_PUBLISH,
          payload: {
            topPick: { title: top.title, keywords: top.keywords },
            retroContext: parsed.retrospective,
            slackUserId: ownerSlackUserId,
          },
          previewText: `📝 *블로그 발행 후보* (${top.blogValueScore}점)\n제목: ${top.title}\n키워드: ${top.keywords.join(', ')}\n✅ 누르면 codex 로 본문 생성 후 Notion 발행.`,
        });
      }
      // 경력 카드 — 오늘 머지된 PR 전체를 다건 통합 회고로 반영(#134 활용). LLM 무관, 결정론적.
      if (mergedPrs.length > 0) {
        const prRefs = mergedPrs.map((pr) => `${pr.repo}#${pr.number}`);
        previews.push({
          kind: PREVIEW_KIND.EVENING_CAREER_REFLECT,
          payload: { prRefs, slackUserId: ownerSlackUserId },
          previewText: `💼 *경력 반영 후보* (오늘 머지 ${prRefs.length}건)\n${prRefs.join(', ')}\n✅ 누르면 이력서 프로필 편입 + 포트폴리오 Notion 반영(다건 통합 회고).`,
        });
      }

      return { skip: false, summaryText, previews };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`저녁 회고 생성 실패 — 텍스트 fallback: ${message}`);
      return {
        skip: false,
        summaryText: `🌙 *오늘의 회고 — ${firedAtKst}*\n_회고 자동 생성에 실패했습니다(${message.slice(0, 120)}). 내일 다시 시도합니다._`,
      };
    }
  }

  private async readRunText(
    agentType: AgentType,
    slackUserId: string,
  ): Promise<string | null> {
    const runs = await this.agentRunService.findRecentSucceededRuns({
      agentType,
      slackUserId,
      sinceDays: 1,
      limit: 1,
    });
    if (runs.length === 0) {
      return null;
    }
    const output = runs[0].output;
    return typeof output === 'string' ? output : JSON.stringify(output);
  }
}
