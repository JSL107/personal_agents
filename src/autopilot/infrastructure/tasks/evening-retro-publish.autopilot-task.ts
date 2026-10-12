import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  buildEveningRetroPrompt,
  EVENING_RETRO_SYSTEM_PROMPT,
  EveningBlogSourcePr,
  EveningPrInput,
  EveningRetroCandidate,
  EveningRetroReflection,
  EveningRetroResult,
  formatRetroContext,
  parseEveningRetroOutput,
  REFLECTION_COLUMNS,
} from '../../../agent/blog/domain/prompt/evening-retro.prompt';
import { groupPrRefsByRepo } from '../../../agent/career-mate/domain/group-pr-refs';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { RunVerdictFacet } from '../../../agent-run/domain/run-verdict';
import {
  countKstDaysBetween,
  getKstDayStartAsUtc,
} from '../../../common/util/kst-date.util';
import {
  classifyRepoSource,
  REPO_SOURCE_LABEL,
  RepoSource,
} from '../../../common/util/repo-source.util';
import { GithubPullRequestSummary } from '../../../github/domain/github.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeEveningRetro } from '../../../humanize/application/humanize-report.adapter';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { FindAllOpenPreviewsUsecase } from '../../../preview-gate/application/find-all-open-previews.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import {
  SLACK_DELIVERY_REPOSITORY,
  SlackDeliveryRepositoryPort,
} from '../../../slack/domain/port/slack-delivery.repository.port';
import { SLACK_DELIVERY_STATUS } from '../../../slack/domain/slack-delivery.type';
import {
  escapeSlackMrkdwn,
  isSafeHttpUrl,
  sanitizeForSlackLink,
} from '../../../slack/format/mrkdwn.util';
import {
  AutopilotPreviewRequest,
  AutopilotRunVerdictRequest,
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';
import {
  DAILY_DIGEST_REPOSITORY_PORT,
  DailyDigestRepositoryPort,
} from '../../domain/port/daily-digest.repository.port';
import {
  EveningDigestInput,
  formatEveningDigest,
} from '../evening-digest.formatter';
import { MorningIncident } from '../morning-digest.formatter';

const RETRO_PR_LIMIT = 20;
// 넘어가는 장애로 올릴 사건의 관측 창 — 아침 한 통과 같은 기준(morning-briefing INCIDENT_SEEN_WINDOW_DAYS).
const INCIDENT_SEEN_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// 마감 한 줄의 재료 중 회고와 무관한 것(투자·넘어가는 것).
type EveningCarryContext = Pick<
  EveningDigestInput,
  'invest' | 'carriedApprovalCount' | 'incidents'
>;
// 아침 계획이 실린 발송의 원장 좌표 — 오케스트레이터가 그룹 본문을 `autopilot:<그룹>` 으로 남긴다.
const MORNING_DELIVERY_KIND = 'autopilot:morning';
const MORNING_BRIEFING_TASK_ID = 'morning-briefing';
// 메인 메시지에 세울 후보 수. 나머지는 스레드 댓글로 내린다 — 후보를 전부 본문에 펼치면
// 한 화면을 넘겨 정작 회고 문단이 밀려난다.
const SUMMARY_CANDIDATE_LIMIT = 3;
const REASON_PREVIEW_MAX_CHARS = 80;
const PR_TITLE_PREVIEW_MAX_CHARS = 60;

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

// 저녁 회고→발행 후보 — evening 그룹(19:40 KST), daily-eval/work-reviewer 뒤 순서.
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
    @Inject(SLACK_DELIVERY_REPOSITORY)
    private readonly deliveryRepository: SlackDeliveryRepositoryPort,
    private readonly findAllOpenPreviews: FindAllOpenPreviewsUsecase,
    @Inject(DAILY_DIGEST_REPOSITORY_PORT)
    private readonly digestRepository: DailyDigestRepositoryPort,
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
    const toPrInput = (
      pullRequest: GithubPullRequestSummary,
    ): EveningPrInput => ({
      repo: pullRequest.repo,
      number: pullRequest.number,
      url: pullRequest.url,
      title: pullRequest.title,
      body: pullRequest.body,
      source: classifyRepoSource(
        pullRequest.repo,
        personalRepositories,
        authorLogin,
      ),
    });

    const mergedPrs: EveningPrInput[] = authorLogin
      ? (
          await this.githubClient.listAuthorMergedPullRequestsSince({
            repo: null,
            author: authorLogin,
            sinceIsoDate,
            limit: RETRO_PR_LIMIT,
          })
        ).map(toPrInput)
      : [];

    // carryOver("오늘 못 끝낸 것") 의 근거. 조회가 깨져도 회고는 계속 돈다 — 저녁 보고가
    // 부가 입력 하나 때문에 통째로 막히는 쪽이 더 나쁘다.
    //
    // 실패를 별도로 표시하는 이유: 실패하면 목록이 `[]` 라 `openPrCount` 가 0 이 되는데,
    // 그 0 은 "오늘 다 끝냈다" 와 생김새가 같다. 실패를 남기지 않으면 carryOver 가 비는 날
    // 무엇 때문인지 영영 가릴 수 없다.
    let openPrFetchFailed = false;
    const openPrs: EveningPrInput[] = authorLogin
      ? await this.githubClient
          .listAuthorOpenPullRequests({
            repo: null,
            author: authorLogin,
            sinceIsoDate,
            limit: RETRO_PR_LIMIT,
          })
          .then((pullRequests) => pullRequests.map(toPrInput))
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `열린 PR 조회 실패 — 미완 근거 없이 진행: ${message}`,
            );
            openPrFetchFailed = true;
            return [];
          })
      : [];

    const worklogText = await this.readRunText(
      AgentType.WORK_REVIEWER,
      ownerSlackUserId,
    );
    const dailyEvalText = await this.readRunText(
      AgentType.PO_EVAL,
      ownerSlackUserId,
    );

    // 아침 계획 판정 — 계획이 맞았는지는 하루를 보낸 뒤에야 알 수 있어 저녁 스레드에서 묻는다
    // (사람 피드백 설계 §3-3). 마감 한 통은 회고 재료가 없는 날에도 나가므로 세 경로 모두에 싣는다.
    const pmPlanVerdict = await this.findTodayPmPlanVerdict(ownerSlackUserId);
    const carry = await this.loadCarryContext(ownerSlackUserId, firedAtKst);
    const buildDigest = (
      input: Pick<EveningDigestInput, 'keep' | 'retroFailure'>,
    ): string =>
      formatEveningDigest({
        firedAtKst,
        mergedPrCount: mergedPrs.length,
        ...carry,
        ...input,
      }) +
      this.buildEvidenceNotice(
        authorLogin,
        mergedPrs.length,
        openPrFetchFailed,
      );

    // 회고 재료가 하나도 없는 날도 하루를 닫는 신호(투자·넘어가는 것)는 낸다 — 회고만 건너뛴다.
    if (mergedPrs.length === 0 && !worklogText && !dailyEvalText) {
      return {
        skip: false,
        summaryText: buildDigest({ keep: null, retroFailure: null }),
        ...(pmPlanVerdict.length > 0 ? { runVerdicts: pmPlanVerdict } : {}),
      };
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
          // carryOver 가 매일 비면 "정말 다 끝낸 날" 인지 "이 조회가 0건인지" 를 이 값으로 가른다.
          // 다만 실패해도 0 이 되므로 그 셋째 경우는 아래 플래그가 가른다.
          openPrCount: openPrs.length,
          openPrFetchFailed,
          hasWorklog: worklogText !== null,
          hasDailyEval: dailyEvalText !== null,
        },
        run: async () => {
          const completion = await this.modelRouter.route({
            agentType: AgentType.EVENING_RETRO,
            request: {
              prompt: buildEveningRetroPrompt({
                mergedPrs,
                openPrs,
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
      // 채널에는 마감 한 통만 남기고, 회고 전문(KPT·발행 후보)은 스레드로 내린다
      // (docs/superpowers/plans/2026-10-08-daily-message-direction.md §3-2). 판정 버튼은 스레드
      // 첫 댓글이고 판정 대상 문장을 인용으로 싣으므로, 회고가 스레드로 가도 무엇을 판정하는지 보인다.
      const summaryText = buildDigest({
        keep: parsed.retrospective.malformed
          ? null
          : (parsed.retrospective.keep?.trim() ?? null) || null,
        retroFailure: null,
      });
      const retroText = `🌙 *오늘의 회고 — ${firedAtKst}*\n\n${this.formatReflectionText(
        parsed.retrospective,
      )}\n\n${this.formatCandidateHeading(
        parsed.candidates.length,
      )}\n${scoreLines || '_후보 없음_'}`;
      const detailText = [
        retroText,
        this.buildCandidateDetailText(parsed.candidates, authorLogin),
      ]
        .filter((part): part is string => Boolean(part))
        .join('\n\n');

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
          retroContext: formatRetroContext(parsed.retrospective),
          slackUserId: ownerSlackUserId,
        };
        // 카드는 읽지 않고 눌린다(분석 보고 §5 질문 3) — 첫 줄만으로 판단되게 점수·제목·근거를 싣고,
        // 둘째 줄은 누르면 무엇이 일어나는지만 적는다. 쓸 가치·초안 개요는 회고 스레드의 후보 상세에 있다.
        // payload 는 그대로다 — 승인 시 반영되는 내용은 바뀌지 않는다.
        previews.push({
          kind: PREVIEW_KIND.EVENING_BLOG_PUBLISH,
          payload,
          previewText: `📝 *블로그 후보 ${top.blogValueScore}점* · 「${top.title}」 · 근거 ${sourceLabel} ${sourceRefsText}\n✅ 누르면 이 PR 들로 본문을 써 Notion 초안으로 올립니다 — GitHub 공개 발행은 따로 묻습니다.`,
        });
      }
      // 경력 카드 — 저장소별로 나눠 회고한다. 하루치를 한 덩어리로 넘기면 서로 무관한 PR 이
      // 하나의 성과로 합쳐지고(회고 프롬프트가 "이어진 PR" 을 전제한다), 모델이 공통점을 찾아
      // 추상화 단계를 올려 제목이 서로 구분되지 않는다 — group-pr-refs.ts 주석 참고.
      if (mergedPrs.length > 0) {
        const { groups, droppedRefCount } = groupPrRefsByRepo(mergedPrs);
        const groupedRefsText = this.formatGroupedPrRefs(mergedPrs);
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
          // 첫 줄만으로 판단되게 건수·저장소 수·반영처를 싣는다. PR 줄은 재서술한 메모 대신 제목+링크로 —
          // 원본은 GitHub 에 있고 메모는 그 사본이었다(분석 보고 §4 3-1).
          // 아래 입력칸 안내는 한 줄로 남긴다. 입력칸의 label·hint 만으로는 "코드에 남지 않는
          // 정보라서 적는다" 는 이유가 전달되지 않는다.
          previewText: `💼 *경력 반영 ${reflectedCount}건* · 저장소 ${groups.length}곳${droppedNote} → 이력서 프로필·포트폴리오 Notion\n${groupedRefsText}\n_(선택) 이 작업이 사용자·비용·처리량에 한 일을 아래 칸에 적으면 이력서 문장이 그 근거를 씁니다 — 코드에는 남지 않는 정보입니다._`,
        });
      }

      // 판정 버튼 — 문제 칸이 빈 날은 「지어냈나」 를 물을 대상이 없어 그 축을 내지 않는다
      // (KPT 설계 §3-2 의 사람 판정 자리. 형식이 깨진 회차도 문제 칸이 없으니 같다).
      // 인용은 화면에 나간 문장 그대로여야 한다 — 그래서 윤문을 거친 `parsed` 에서 읽는다
      // (원장의 `outcome.result` 는 윤문 전 원문이라 화면과 다르다).
      const problemSentence = parsed.retrospective.problem?.trim();
      const verdictFacets: RunVerdictFacet[] = problemSentence
        ? ['retro_problem', 'overall']
        : ['overall'];

      return {
        skip: false,
        summaryText,
        detailText,
        // 회고 전문은 이제 스레드에만 있다. 스레드가 실패하면 채널에 대신 붙인다(중복 > 유실).
        detailIsOnlyCopy: true,
        previews,
        runVerdicts: [
          {
            agentRunId: outcome.agentRunId,
            facets: verdictFacets,
            ...(problemSentence ? { quote: problemSentence } : {}),
          },
          ...pmPlanVerdict,
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`저녁 회고 생성 실패 — 텍스트 fallback: ${message}`);
      return {
        skip: false,
        summaryText: buildDigest({
          keep: null,
          retroFailure: message.slice(0, 120),
        }),
        ...(pmPlanVerdict.length > 0 ? { runVerdicts: pmPlanVerdict } : {}),
      };
    }
  }

  /**
   * KPT 회고 네 칸 — 빈 칸도 「없음」 으로 찍는다.
   *
   * 빈 칸을 숨기면 "오늘 문제가 없었다" 와 "그런 칸이 원래 없다" 가 화면에서 같아진다. 그러면
   * 모델이 없는 문제를 지어내기 시작해도 사람이 알아챌 표면이 사라진다. 이 네 줄이 억지 채움을
   * 감시하는 유일한 장치라, 짧아지는 것보다 보이는 것을 택한다.
   *
   * 판정은 사람이 한다 — 칸이 찼다는 사실만으로는 지어낸 것인지 실제로 아쉬웠던 것인지 갈리지
   * 않는다(개발하는 날 아쉬운 점이 하나도 없는 쪽이 오히려 드물다). 도입 후 7 영업일의 problem
   * 칸을 사용자가 직접 읽고 지어냄이 3건 이상이면 problem 칸을 걷어낸다.
   */
  private formatReflectionText(reflection: EveningRetroReflection): string {
    if (reflection.malformed) {
      const notice =
        '_⚠️ 회고를 읽지 못했습니다(모델이 형식을 어겼습니다). 아래 후보는 정상입니다._';
      // 형식만 틀렸을 뿐 읽을 수 있는 회고라면 그대로 보여준다. 칸으로 나뉘지 않았다는
      // 사실은 위 줄이 이미 알리므로, 내용까지 버릴 이유가 없다.
      return reflection.rawText ? `${notice}\n${reflection.rawText}` : notice;
    }
    return REFLECTION_COLUMNS.map(
      ({ key, label }) => `*${label}* ${reflection[key] ?? '없음'}`,
    ).join('\n');
  }

  // 마감 한 줄의 투자·넘어감 재료. 하나가 실패해도 마감 메시지는 나가야 한다 — 실패한 줄만 빠진다.
  private async loadCarryContext(
    ownerSlackUserId: string,
    firedAtKst: string,
  ): Promise<EveningCarryContext> {
    const now = new Date();
    // paper_* 의 거래일 컬럼은 @db.Date 라 UTC 자정으로 맞춘다.
    const tradeDate = new Date(`${firedAtKst}T00:00:00.000Z`);
    const [invest, carriedApprovalCount, incidents] = await Promise.all([
      this.loadInvest(tradeDate),
      this.findAllOpenPreviews
        .execute({ now })
        .then(
          (previews) =>
            previews.filter(
              (preview) => preview.slackUserId === ownerSlackUserId,
            ).length,
        )
        .catch((error: unknown) => {
          this.logger.warn(`승인 대기 조회 실패 — 줄 생략: ${String(error)}`);
          return 0;
        }),
      this.digestRepository
        .findOpenIncidents({
          seenSince: new Date(
            now.getTime() - INCIDENT_SEEN_WINDOW_DAYS * DAY_MS,
          ),
        })
        .then((rows): MorningIncident[] =>
          rows.map((row) => ({
            label: row.label,
            dayCount: countKstDaysBetween(row.openedAt, now) + 1,
          })),
        )
        .catch((error: unknown) => {
          this.logger.warn(`열린 장애 조회 실패 — 줄 생략: ${String(error)}`);
          return [];
        }),
    ]);
    return { invest, carriedApprovalCount, incidents };
  }

  private async loadInvest(
    tradeDate: Date,
  ): Promise<EveningDigestInput['invest']> {
    try {
      const [returns, filled, next, recommendRuns] = await Promise.all([
        this.digestRepository.findPaperReturns({ tradeDate }),
        this.digestRepository.countPaperTrades({ tradeDate }),
        this.digestRepository.countPaperOrdersAfter({ tradeDate }),
        this.agentRunService.findRecentSucceededRuns({
          agentType: AgentType.PAPER_RECOMMEND,
          sinceDays: 1,
          limit: 1,
        }),
      ]);
      // 평가·체결·예정이 모두 없던 날(휴장·모의투자 꺼짐)만 줄을 내지 않는다. 평가가 실패해도
      // 추천은 따로 돌아 내일 주문을 만들 수 있으므로, 예정 주문이 있으면 줄을 낸다.
      if (
        returns.length === 0 &&
        filled.buyCount + filled.sellCount === 0 &&
        next.buyCount + next.sellCount === 0
      ) {
        return null;
      }
      // 추천(19:30)이 이 회차(19:40)보다 늦게 끝났으면 원장에 오늘 실행이 아직 없다 — "0건" 과 구분한다.
      return { returns, filled, next: recommendRuns.length > 0 ? next : null };
    } catch (error: unknown) {
      this.logger.warn(`모의투자 마감 조회 실패 — 줄 생략: ${String(error)}`);
      return null;
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
    openPrFetchFailed: boolean,
  ): string {
    if (!authorLogin) {
      return '\n\n_⚠️ `IMPACT_REPORT_GITHUB_AUTHOR` 가 없어 머지 PR 을 조회하지 않았습니다 — 근거 없이 쓴 회고입니다._';
    }
    // 열린 PR 조회가 깨지면 「미완」 칸의 근거가 통째로 없는 채로 회고가 나간다. 그 사실을
    // 로그에만 두면 「미완: 없음」 이 "다 끝냈다" 로 읽힌다 — 이 보고에서 유일하게 무시되지
    // 않는 표면이 이 메시지다.
    const openPrNotice = openPrFetchFailed
      ? '\n\n_⚠️ 열린 PR 조회가 실패해 「미완」 칸의 근거가 없습니다. 비어 있어도 다 끝냈다는 뜻이 아닙니다._'
      : '';
    if (mergedCount === 0) {
      return `\n\n_⚠️ 오늘 머지된 PR 이 0건으로 조회됐습니다. 실제로 없었다면 정상이지만, 며칠 연속이면 GitHub 조회 경로를 확인하세요._${openPrNotice}`;
    }
    return openPrNotice;
  }

  // 오늘(KST) 아침 브리핑이 낸 PM 실행. 수동 `/today` 는 아침 보고로 나간 계획이 아니라 제외한다.
  // 아침 PM 이 실패한 날은 판정할 대상이 없어 빈 배열이다. 조회 실패도 회고를 막지 않는다.
  private async findTodayPmPlanVerdict(
    slackUserId: string,
  ): Promise<AutopilotRunVerdictRequest[]> {
    try {
      // sinceDays: 1 = 오늘 KST 0시 이후에 끝난 실행(저장소 구현이 KST 날짜 경계로 자른다).
      const runs = await this.agentRunService.findRecentSucceededRuns({
        agentType: AgentType.PM,
        slackUserId,
        sinceDays: 1,
        // 수동 /today 가 같은 날 여러 번 돌아도 아침 cron 실행이 창 밖으로 밀리지 않게 넉넉히 읽는다.
        // ponytail: 하루 20회를 넘기면 다시 놓친다 — 그때는 저장소 조회에 triggerType 조건을 넣는다.
        limit: 20,
      });
      const found = runs.find(
        (run) => run.triggerType === TriggerType.MORNING_BRIEFING_CRON,
      );
      if (!found) {
        return [];
      }
      // 실행이 성공해도 아침 메시지가 나가지 않았으면 사람은 그 계획을 본 적이 없다 — 본 적 없는
      // 계획에 받은 판정이 그 실행의 품질 신호로 쌓이지 않게, 오늘 아침 그룹 본문이 실제로
      // 발송(SENT)된 날만 묻는다. 원장에 agentRunId 가 없어 그룹·task·날짜로 맞춘다.
      const deliveries = await this.deliveryRepository.findSince(
        getKstDayStartAsUtc(),
      );
      const morningDelivered = deliveries.some(
        (delivery) =>
          delivery.kind === MORNING_DELIVERY_KIND &&
          delivery.itemKinds.includes(MORNING_BRIEFING_TASK_ID) &&
          delivery.threadTs === null &&
          delivery.status === SLACK_DELIVERY_STATUS.SENT,
      );
      if (!morningDelivered) {
        this.logger.log(
          `아침 브리핑 발송 기록 없음 — 계획 판정 생략 (agentRunId=${found.id})`,
        );
        return [];
      }
      return [{ agentRunId: found.id, facets: ['pm_plan'] }];
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`아침 계획 실행 조회 실패 — 계획 판정 생략: ${message}`);
      return [];
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

  private formatGroupedPrRefs(pullRequests: EveningPrInput[]): string {
    const lines = (['company', 'personal'] as const)
      .map((source) => {
        const refs = pullRequests
          .filter((pullRequest) => pullRequest.source === source)
          .map((pullRequest) => this.formatCareerPrLine(pullRequest));
        if (refs.length === 0) {
          return null;
        }
        return `• ${REPO_SOURCE_LABEL[source]}:\n${refs.join('\n')}`;
      })
      .filter((line): line is string => line !== null);

    return lines.join('\n');
  }

  private formatCareerPrLine(pullRequest: EveningPrInput): string {
    const ref = this.formatShortRef(
      `${pullRequest.repo}#${pullRequest.number}`,
    );
    const linkedRef = isSafeHttpUrl(pullRequest.url)
      ? `<${sanitizeForSlackLink(pullRequest.url)}|${ref}>`
      : ref;
    const title = pullRequest.title.trim();
    if (!title) {
      return `  • ${linkedRef}`;
    }
    return `  • ${linkedRef} ${escapeSlackMrkdwn(this.truncateText(title, PR_TITLE_PREVIEW_MAX_CHARS))}`;
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
