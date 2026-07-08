import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  buildEveningRetroPrompt,
  EVENING_RETRO_SYSTEM_PROMPT,
  EveningBlogSourcePr,
  EveningPrInput,
  EveningRetroCandidate,
  parseEveningRetroOutput,
} from '../../../agent/blog/domain/prompt/evening-retro.prompt';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { getTodayKstDate } from '../../../common/util/kst-date.util';
import {
  classifyRepoSource,
  REPO_SOURCE_LABEL,
  RepoSource,
} from '../../../common/util/repo-source.util';
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
const DEFAULT_PERSONAL_REPOSITORIES = ['JSL107/personal_agents'];
const REASON_PREVIEW_MAX_CHARS = 120;

interface TopPickPayload {
  title: string;
  keywords: string[];
  reason: string;
  sourceRefs: string[];
}

interface EveningBlogPayload {
  topPick: TopPickPayload;
  sourcePrs: EveningBlogSourcePr[];
  retroContext: string;
  slackUserId: string;
}

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
    const sinceIsoDate = `${getTodayKstDate()}T00:00:00+09:00`;
    const personalRepositories = this.getPersonalRepositories();
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
          source: classifyRepoSource(pr.repo, personalRepositories),
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
        .map((candidate) => this.formatCandidateLine(candidate))
        .join('\n');
      const summaryText = `🌙 *오늘의 회고 & 발행 후보 — ${firedAtKst}*\n\n${parsed.retrospective}\n\n*발행 후보(가치 점수)*\n${scoreLines || '_후보 없음_'}`;

      const previews: AutopilotPreviewRequest[] = [];
      // 블로그 카드 — 대표(최고점) 후보 기준. candidates 있을 때만.
      const top = parsed.candidates[0];
      if (top) {
        const sourcePrs = this.resolveSourcePrs(top.sourceRefs, mergedPrs);
        const sourceLabel = this.formatSourceRefsLabel(top.sourceRefs);
        const sourceRefsText = this.formatSourceRefsText(top.sourceRefs);
        const payload: EveningBlogPayload = {
          topPick: {
            title: top.title,
            keywords: top.keywords,
            reason: top.reason,
            sourceRefs: top.sourceRefs,
          },
          sourcePrs,
          retroContext: parsed.retrospective,
          slackUserId: ownerSlackUserId,
        };
        previews.push({
          kind: PREVIEW_KIND.EVENING_BLOG_PUBLISH,
          payload,
          previewText: `📝 *블로그 발행 후보* (${top.blogValueScore}점) · ${sourceLabel}\n제목: ${top.title}\n근거 PR: ${sourceRefsText}\n왜 쓸 가치: ${top.reason}\n✅ 누르면 위 PR 내용을 근거로 codex 가 본문 생성 후 Notion 발행.`,
        });
      }
      // 경력 카드 — 오늘 머지된 PR 전체를 다건 통합 회고로 반영(#134 활용). LLM 무관, 결정론적.
      if (mergedPrs.length > 0) {
        const prRefs = mergedPrs.map(
          (pullRequest) => `${pullRequest.repo}#${pullRequest.number}`,
        );
        const groupedRefsText = this.formatGroupedPrRefs(mergedPrs);
        previews.push({
          kind: PREVIEW_KIND.EVENING_CAREER_REFLECT,
          payload: { prRefs, slackUserId: ownerSlackUserId },
          previewText: `💼 *경력 반영 후보* (오늘 머지 ${prRefs.length}건)\n${groupedRefsText}\n✅ 누르면 이력서 프로필 편입 + 포트폴리오 Notion 반영(다건 통합 회고).`,
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

  private getPersonalRepositories(): string[] {
    const configured = this.config.get<string>('PERSONAL_REPOS');
    const repositories =
      configured
        ?.split(',')
        .map((repositoryName) => repositoryName.trim())
        .filter((repositoryName) => repositoryName.length > 0) ?? [];
    if (repositories.length > 0) {
      return repositories;
    }
    return DEFAULT_PERSONAL_REPOSITORIES;
  }

  private formatCandidateLine(candidate: EveningRetroCandidate): string {
    const sourceLabel = this.formatSourceRefsLabel(candidate.sourceRefs);
    const sourceRefsText = this.formatSourceRefsText(candidate.sourceRefs);
    const reason = this.truncateText(
      candidate.reason,
      REASON_PREVIEW_MAX_CHARS,
    );

    return `• (${candidate.blogValueScore}점) ${candidate.title} — ${candidate.keywords.join(', ')}\n    ↳ ${sourceLabel} · ${sourceRefsText} · ${reason}`;
  }

  private formatGroupedPrRefs(pullRequests: EveningPrInput[]): string {
    const lines = (['company', 'personal'] as const)
      .map((source) => {
        const refs = pullRequests
          .filter((pullRequest) => pullRequest.source === source)
          .map((pullRequest) => `${pullRequest.repo}#${pullRequest.number}`);
        if (refs.length === 0) {
          return null;
        }
        return `• ${REPO_SOURCE_LABEL[source]}: ${refs.join(', ')}`;
      })
      .filter((line): line is string => line !== null);

    return lines.join('\n');
  }

  private resolveSourcePrs(
    sourceRefs: string[],
    pullRequests: EveningPrInput[],
  ): EveningBlogSourcePr[] {
    return sourceRefs
      .map((sourceRef) =>
        pullRequests.find(
          (pullRequest) =>
            `${pullRequest.repo}#${pullRequest.number}` === sourceRef,
        ),
      )
      .filter(
        (pullRequest): pullRequest is EveningPrInput =>
          pullRequest !== undefined,
      )
      .map((pullRequest) => ({
        repo: pullRequest.repo,
        number: pullRequest.number,
        url: pullRequest.url,
        title: pullRequest.title,
        body: pullRequest.body,
      }));
  }

  private formatSourceRefsLabel(sourceRefs: string[]): string {
    const sources = new Set<RepoSource>(
      sourceRefs.map((sourceRef) => this.classifySourceRef(sourceRef)),
    );
    if (sources.size > 1) {
      return '회사·개인';
    }
    const source = sources.values().next().value ?? 'company';
    return REPO_SOURCE_LABEL[source];
  }

  private classifySourceRef(sourceRef: string): RepoSource {
    const repositoryName = sourceRef.split('#')[0] ?? '';
    return classifyRepoSource(repositoryName, this.getPersonalRepositories());
  }

  private formatSourceRefsText(sourceRefs: string[]): string {
    if (sourceRefs.length === 0) {
      return '근거 PR 없음';
    }
    return sourceRefs
      .map((sourceRef) => this.formatShortRef(sourceRef))
      .join(', ');
  }

  private formatShortRef(sourceRef: string): string {
    const [repositoryName, number] = sourceRef.split('#');
    const repositoryShortName =
      repositoryName.split('/').at(-1) ?? repositoryName;
    if (!number) {
      return repositoryShortName;
    }
    return `${repositoryShortName}#${number}`;
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}...`;
  }
}
