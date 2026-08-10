import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  buildEveningRetroPrompt,
  EVENING_RETRO_SYSTEM_PROMPT,
  EveningBlogSourcePr,
  EveningPrInput,
  EveningPrNote,
  EveningRetroCandidate,
  EveningRetroResult,
  parseEveningRetroOutput,
} from '../../../agent/blog/domain/prompt/evening-retro.prompt';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { getKstDayStartAsUtc } from '../../../common/util/kst-date.util';
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
const REASON_PREVIEW_MAX_CHARS = 120;
const PR_NOTE_PREVIEW_MAX_CHARS = 100;

interface TopPickPayload {
  title: string;
  keywords: string[];
  reason: string;
  sourceRefs: string[];
  outline: string[];
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
    const authorLogin = author?.trim() ? author.trim() : undefined;
    // ⚠️ 이 값은 GitHub search 쿼리(`merged:>=<값>`)에 그대로 박힌다. `+09:00` 같은 offset
    // 표기를 쓰면 octokit 이 `+` 를 escape 하지 않아 GitHub 이 공백으로 읽고, 에러 대신
    // **조용히 0건**을 돌려준다("오늘 머지된 PR 없음"으로 위장됨). 항상 UTC(Z) 표기로 넘긴다.
    const sinceIsoDate = getKstDayStartAsUtc().toISOString();
    const personalRepositories = this.getPersonalRepositories();
    const mergedPrs: EveningPrInput[] = authorLogin
      ? (
          await this.githubClient.listAuthorMergedPullRequestsSince({
            repo: null,
            author: authorLogin,
            sinceIsoDate,
            limit: RETRO_PR_LIMIT,
          })
        ).map((pr) => ({
          repo: pr.repo,
          number: pr.number,
          url: pr.url,
          title: pr.title,
          body: pr.body,
          source: classifyRepoSource(
            pr.repo,
            personalRepositories,
            authorLogin,
          ),
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
      // 실행 원장에 남긴다. 이 task 는 블로그·경력 카드를 만드는 유일한 경로인데, 원장을
      // 거치지 않으면 카드가 안 온 날 "회고 생성이 실패했는지 / 후보가 0건이었는지 / 아예
      // 돌지 않았는지" 가 전부 똑같이 '기록 없음' 으로 보인다. 실패율·소요시간을 보는 도구는
      // agent_run 하나뿐이라, 여기 없으면 무엇이 느려지거나 깨져도 계측에 잡히지 않는다.
      const outcome = await this.agentRunService.execute<EveningRetroResult>({
        agentType: AgentType.EVENING_RETRO,
        triggerType: TriggerType.AUTOPILOT_EVENING_RETRO_CRON,
        inputSnapshot: {
          taskId: this.id,
          firedAtKst,
          mergedPrCount: mergedPrs.length,
          hasWorklog: worklogText !== null,
          hasDailyEval: dailyEvalText !== null,
        },
        run: async () => {
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
          const parsedOutput = parseEveningRetroOutput(completion.text);
          return {
            result: parsedOutput,
            modelUsed: completion.modelUsed,
            output: parsedOutput,
          };
        },
      });
      const parsed = outcome.result;

      const scoreLines = parsed.candidates
        .map((candidate) => this.formatCandidateLine(candidate, authorLogin))
        .join('\n');
      const summaryText = `🌙 *오늘의 회고 & 발행 후보 — ${firedAtKst}*\n\n${parsed.retrospective}\n\n*발행 후보(가치 점수)*\n${scoreLines || '_후보 없음_'}${this.buildEvidenceNotice(
        authorLogin,
        mergedPrs.length,
      )}`;

      const previews: AutopilotPreviewRequest[] = [];
      // 블로그 카드 — 대표(최고점) 후보 기준. candidates 있을 때만.
      const top = parsed.candidates[0];
      if (top) {
        const sourcePrs = this.resolveSourcePrs(top.sourceRefs, mergedPrs);
        const sourceLabel = this.formatSourceRefsLabel(
          top.sourceRefs,
          authorLogin,
        );
        const sourceRefsText = this.formatSourceRefsText(top.sourceRefs);
        const payload: EveningBlogPayload = {
          topPick: {
            title: top.title,
            keywords: top.keywords,
            reason: top.reason,
            sourceRefs: top.sourceRefs,
            outline: top.outline,
          },
          sourcePrs,
          retroContext: parsed.retrospective,
          slackUserId: ownerSlackUserId,
        };
        const outlineText = this.formatOutlineText(top.outline);
        const applyGuide = top.outline.length
          ? '✅ 누르면 위 PR 내용과 초안 개요를 근거로 codex 가 본문 생성 후 Notion 발행.'
          : '✅ 누르면 위 PR 내용을 근거로 codex 가 본문 생성 후 Notion 발행.';
        previews.push({
          kind: PREVIEW_KIND.EVENING_BLOG_PUBLISH,
          payload,
          previewText: `📝 *블로그 발행 후보* (${top.blogValueScore}점) · ${sourceLabel}\n제목: ${top.title}\n근거 PR: ${sourceRefsText}\n왜 쓸 가치: ${top.reason}${outlineText}\n${applyGuide}`,
        });
      }
      // 경력 카드 — 오늘 머지된 PR 전체를 다건 통합 회고로 반영(#134 활용). payload 는 기존 prRefs 그대로 유지.
      if (mergedPrs.length > 0) {
        const prRefs = mergedPrs.map(
          (pullRequest) => `${pullRequest.repo}#${pullRequest.number}`,
        );
        const groupedRefsText = this.formatGroupedPrRefs(
          mergedPrs,
          parsed.prNotes,
        );
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

  /**
   * 근거 PR 이 0건이라는 사실 자체를 보고에 남긴다.
   *
   * 근거가 없으면 후보도 따라서 사라지는데, "정말 PR 이 없던 날" 과 "조회가 깨진 날" 은
   * 결과가 똑같이 "후보 없음" 이라 구분되지 않는다. 후자는 에러도 알림도 남기지 않아
   * 조용히 몇 주씩 방치된다 — 실제로 `sinceIsoDate` 의 `+09:00` 이 GitHub 검색을
   * 깨뜨려 두 주 가까이 0건이었고, 회고 본문은 그걸 "오늘 머지된 PR이 없고" 라고
   * 자연스럽게 서술해 아무도 이상하게 여기지 않았다.
   *
   * 막지는 않는다. 사실을 한 줄 남겨 사람이 며칠 연속인지 눈치챌 수 있게만 한다.
   */
  private buildEvidenceNotice(
    authorLogin: string | undefined,
    mergedCount: number,
  ): string {
    if (!authorLogin) {
      return '\n\n_⚠️ `IMPACT_REPORT_GITHUB_AUTHOR` 가 없어 머지 PR 을 조회하지 않았습니다 — 근거 없이 쓴 회고입니다._';
    }
    if (mergedCount === 0) {
      return '\n\n_⚠️ 오늘 머지된 PR 이 0건으로 조회됐습니다. 실제로 없었다면 정상이지만, 며칠 연속이면 GitHub 조회 경로를 확인하세요._';
    }
    return '';
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
    return [];
  }

  private formatCandidateLine(
    candidate: EveningRetroCandidate,
    authorLogin: string | undefined,
  ): string {
    const sourceLabel = this.formatSourceRefsLabel(
      candidate.sourceRefs,
      authorLogin,
    );
    const sourceRefsText = this.formatSourceRefsText(candidate.sourceRefs);
    const reason = this.truncateText(
      candidate.reason,
      REASON_PREVIEW_MAX_CHARS,
    );

    return `• (${candidate.blogValueScore}점) ${candidate.title} — ${candidate.keywords.join(', ')}\n    ↳ ${sourceLabel} · ${sourceRefsText} · ${reason}`;
  }

  private formatGroupedPrRefs(
    pullRequests: EveningPrInput[],
    prNotes: EveningPrNote[],
  ): string {
    const noteByRef = new Map(prNotes.map((note) => [note.ref, note.note]));
    const lines = (['company', 'personal'] as const)
      .map((source) => {
        const refs = pullRequests
          .filter((pullRequest) => pullRequest.source === source)
          .map((pullRequest) =>
            this.formatCareerPrLine(pullRequest, noteByRef),
          );
        if (refs.length === 0) {
          return null;
        }
        return `• ${REPO_SOURCE_LABEL[source]}:\n${refs.join('\n')}`;
      })
      .filter((line): line is string => line !== null);

    return lines.join('\n');
  }

  private formatCareerPrLine(
    pullRequest: EveningPrInput,
    noteByRef: Map<string, string>,
  ): string {
    const ref = `${pullRequest.repo}#${pullRequest.number}`;
    const note = noteByRef.get(ref)?.trim() || pullRequest.title.trim();
    if (!note) {
      return `  • ${ref}`;
    }
    const truncatedNote = this.truncateText(note, PR_NOTE_PREVIEW_MAX_CHARS);
    return `  • ${ref} — ${truncatedNote}`;
  }

  private formatOutlineText(outline: string[]): string {
    if (outline.length === 0) {
      return '';
    }
    const bullets = outline.map((line) => `\n • ${line}`).join('');
    return `\n*초안 개요*${bullets}`;
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

  private formatSourceRefsLabel(
    sourceRefs: string[],
    authorLogin: string | undefined,
  ): string {
    const sources = new Set<RepoSource>(
      sourceRefs.map((sourceRef) =>
        this.classifySourceRef(sourceRef, authorLogin),
      ),
    );
    if (sources.size > 1) {
      return '회사·개인';
    }
    const source = sources.values().next().value ?? 'company';
    return REPO_SOURCE_LABEL[source];
  }

  private classifySourceRef(
    sourceRef: string,
    authorLogin: string | undefined,
  ): RepoSource {
    const repositoryName = sourceRef.split('#')[0] ?? '';
    return classifyRepoSource(
      repositoryName,
      this.getPersonalRepositories(),
      authorLogin,
    );
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
