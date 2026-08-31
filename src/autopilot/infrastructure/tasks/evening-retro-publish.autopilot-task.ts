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
import { groupPrRefsByRepo } from '../../../agent/career-mate/domain/group-pr-refs';
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
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeEveningRetro } from '../../../humanize/application/humanize-report.adapter';
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
// 메인 메시지에 세울 후보 수. 나머지는 스레드 댓글로 내린다 — 후보를 전부 본문에 펼치면
// 한 화면을 넘겨 정작 회고 문단이 밀려난다.
const SUMMARY_CANDIDATE_LIMIT = 3;
const REASON_PREVIEW_MAX_CHARS = 80;
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
    private readonly humanizeService: HumanizeService,
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
          // 사용자 한정 원장 집계(`/quota` 등)는 inputSnapshot.slackUserId JSON path 로만
          // 필터하므로, 이 키가 없으면 새로 남긴 실행이 그 표면에서 통째로 빠진다.
          slackUserId: ownerSlackUserId,
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
      // 화면에 나가는 서술만 윤문한다. 원장(outcome.result)에는 모델 원문이 그대로 남아
      // 사후에 "무엇을 다듬은 결과인지" 대조할 수 있다. 윤문은 best-effort 라 실패하면
      // HumanizeService 가 입력을 그대로 돌려준다 — 보고가 막히지 않는다.
      const parsed = await humanizeEveningRetro(
        outcome.result,
        this.humanizeService,
      );

      const summaryCandidates = parsed.candidates.slice(
        0,
        SUMMARY_CANDIDATE_LIMIT,
      );
      const scoreLines = summaryCandidates
        .map((candidate) => this.formatCandidateLine(candidate, authorLogin))
        .join('\n');
      const summaryText = `🌙 *오늘의 회고 — ${firedAtKst}*\n\n${parsed.retrospective}\n\n${this.formatCandidateHeading(
        parsed.candidates.length,
      )}\n${scoreLines || '_후보 없음_'}${this.buildEvidenceNotice(
        authorLogin,
        mergedPrs.length,
      )}`;
      const detailText = this.buildCandidateDetailText(
        parsed.candidates,
        authorLogin,
      );

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
      // 경력 카드 — 저장소별로 나눠 회고한다. 하루치를 한 덩어리로 넘기면 서로 무관한 PR 이
      // 하나의 성과로 합쳐지고(회고 프롬프트가 "이어진 PR" 을 전제한다), 모델이 공통점을 찾아
      // 추상화 단계를 올려 제목이 서로 구분되지 않는다 — group-pr-refs.ts 주석 참고.
      if (mergedPrs.length > 0) {
        const { groups, droppedRefCount } = groupPrRefsByRepo(mergedPrs);
        const groupedRefsText = this.formatGroupedPrRefs(
          mergedPrs,
          parsed.prNotes,
        );
        const reflectedCount = groups.reduce(
          (total, group) => total + group.refs.length,
          0,
        );
        const droppedNote =
          droppedRefCount > 0 ? ` · 상한 초과 ${droppedRefCount}건 제외` : '';
        previews.push({
          kind: PREVIEW_KIND.EVENING_CAREER_REFLECT,
          payload: {
            prGroups: groups.map((group) => group.refs),
            slackUserId: ownerSlackUserId,
          },
          // 아래 입력칸 안내를 본문에도 한 줄 둔다. 입력칸의 label·hint 만으로는 "왜
          // 적어야 하는지" 가 없어서, 코드에 남지 않는 정보라는 사실이 전달되지 않는다.
          previewText: `💼 *경력 반영 후보* (오늘 머지 ${reflectedCount}건 · 저장소 ${groups.length}곳${droppedNote})\n${groupedRefsText}\n✅ 누르면 저장소별로 나눠 성과 ${groups.length}건을 이력서 프로필에 편입 + 포트폴리오 Notion 반영.\n📝 이 작업이 사용자·매출·비용·처리량에 무엇을 했는지는 코드에 남지 않습니다 — 아래 칸에 저장소별로 적어 두면 이력서 문장이 그 근거를 씁니다(선택).`,
        });
      }

      return { skip: false, summaryText, detailText, previews };
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

  /** 메인 메시지 후보 줄 — 점수·제목·근거만. 키워드는 스레드로 내린다(영문 나열이 줄을 밀어낸다). */
  private formatCandidateLine(
    candidate: EveningRetroCandidate,
    authorLogin: string | undefined,
  ): string {
    const sourceLabel = this.formatSourceRefsLabel(
      candidate.sourceRefs,
      authorLogin,
    );
    const sourceRefsText = this.formatSourceRefsText(candidate.sourceRefs);
    const reason = this.summarizeReason(candidate.reason);

    return `• *${candidate.blogValueScore}점* ${candidate.title}\n    ↳ ${sourceLabel} · ${sourceRefsText} · ${reason}`;
  }

  /**
   * 메인 메시지용 이유 — 길면 **문장 경계**에서 끊는다.
   *
   * 글자 수로만 자르면 "…블로그와" 처럼 문장 한복판이 잘려 무슨 말인지 알 수 없다.
   * 윤문을 거친 뒤 문장이 짧아져(실측 평균 34자) 첫 문장만으로도 요지가 선다.
   * 첫 문장 자체가 상한을 넘는 예외에서만 기존 글자 수 자르기로 떨어진다.
   */
  private summarizeReason(reason: string): string {
    if (reason.length <= REASON_PREVIEW_MAX_CHARS) {
      return reason;
    }
    // 산출물은 '~다.' 로 끝나는 문어체다(윤문 프롬프트가 구어 반말을 금지).
    const firstSentenceEnd = reason.indexOf('다. ');
    if (
      firstSentenceEnd > 0 &&
      firstSentenceEnd + 2 <= REASON_PREVIEW_MAX_CHARS
    ) {
      return `${reason.slice(0, firstSentenceEnd + 2)} …`;
    }
    return this.truncateText(reason, REASON_PREVIEW_MAX_CHARS);
  }

  private formatCandidateHeading(totalCount: number): string {
    if (totalCount <= SUMMARY_CANDIDATE_LIMIT) {
      return '*발행 후보(가치 점수)*';
    }
    return `*발행 후보(가치 점수)* — ${totalCount}건 중 상위 ${SUMMARY_CANDIDATE_LIMIT}건 (전체는 스레드에)`;
  }

  /**
   * 스레드 댓글 본문 — 후보 전체를 키워드·이유 전문과 함께 싣는다.
   *
   * 메인 메시지는 상위 몇 건만, 이유도 잘라서, 키워드는 아예 빼고 보여준다. 그래서
   * **메인에서 빠진 것이 하나라도 있으면** 스레드를 만든다. 특히 키워드는 메인에 자리가
   * 없으니(영문 나열이 줄을 밀어낸다) 여기가 유일한 표시 위치다 — 이 조건을 빼면 후보가
   * 적고 이유가 짧은 날 키워드가 보고 어디에도 남지 않는다.
   *
   * 빠진 게 하나도 없을 때만 만들지 않는다(undefined → orchestrator 가 스레드 생략).
   */
  private buildCandidateDetailText(
    candidates: EveningRetroCandidate[],
    authorLogin: string | undefined,
  ): string | undefined {
    const hasHiddenCandidate = candidates.length > SUMMARY_CANDIDATE_LIMIT;
    const hasTruncatedReason = candidates.some(
      (candidate) => candidate.reason.length > REASON_PREVIEW_MAX_CHARS,
    );
    const hasKeyword = candidates.some(
      (candidate) => candidate.keywords.length > 0,
    );
    if (!hasHiddenCandidate && !hasTruncatedReason && !hasKeyword) {
      return undefined;
    }

    const lines = candidates.map((candidate) => {
      const sourceLabel = this.formatSourceRefsLabel(
        candidate.sourceRefs,
        authorLogin,
      );
      const sourceRefsText = this.formatSourceRefsText(candidate.sourceRefs);
      const keywordsText = candidate.keywords.join(', ');
      const keywordSuffix = keywordsText ? ` — ${keywordsText}` : '';
      return `• (${candidate.blogValueScore}점) ${candidate.title}${keywordSuffix}\n    ↳ ${sourceLabel} · ${sourceRefsText}\n    ↳ ${candidate.reason}`;
    });

    return `*발행 후보 전체 — ${candidates.length}건*\n${lines.join('\n')}`;
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
