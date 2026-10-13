import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { GenerateDailyPlanUsecase } from '../../../agent/pm/application/generate-daily-plan.usecase';
import { PmAgentException } from '../../../agent/pm/domain/pm-agent.exception';
import { TaskItem } from '../../../agent/pm/domain/pm-agent.type';
import { PmAgentErrorCode } from '../../../agent/pm/domain/pm-agent-error-code.enum';
import { summarizePortfolioValue } from '../../../agent/stock/domain/portfolio-exposure';
import { USD_KRW_PAIR } from '../../../agent/stock/domain/stock-monitor.type';
import { formatPortfolioValue } from '../../../agent/stock/infrastructure/stock-monitor.formatter';
import { StockMonitorPrismaRepository } from '../../../agent/stock/infrastructure/stock-monitor.prisma.repository';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import {
  countKstDaysBetween,
  formatKstDate,
  getKstDayStartAsUtc,
} from '../../../common/util/kst-date.util';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeDailyPlan } from '../../../humanize/application/humanize-report.adapter';
import { ListNotifiablePostingsUsecase } from '../../../job-feed/application/list-notifiable-postings.usecase';
import { parseAvoidSkillTags } from '../../../job-feed/domain/avoid-skills';
import {
  DEFAULT_JOB_MATCH_THRESHOLD,
  DEFAULT_JOB_NOTIFY_LIMIT,
} from '../../../job-feed/domain/notify-policy';
import {
  JOB_POSTING_REPOSITORY_PORT,
  JobPostingRepositoryPort,
  StoredJobPosting,
} from '../../../job-feed/domain/port/job-posting.repository.port';
import { formatJobFeedDigest } from '../../../job-feed/infrastructure/job-feed.formatter';
import { FindAllOpenPreviewsUsecase } from '../../../preview-gate/application/find-all-open-previews.usecase';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { ListSchedulesUsecase } from '../../../schedule/application/list-schedules.usecase';
import {
  plainDateToUtcDate,
  todayInKst,
} from '../../../schedule/domain/parse-due-date';
import { formatDailyPlan } from '../../../slack/format/daily-plan.formatter';
import { formatModelFooter } from '../../../slack/format/model-footer.formatter';
import { formatUpcomingLine } from '../../../slack/format/schedule-briefing.formatter';
import { formatWaitingSection } from '../../../slack/format/waiting-section.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';
import {
  DAILY_DIGEST_REPOSITORY_PORT,
  DailyDigestRepositoryPort,
} from '../../domain/port/daily-digest.repository.port';
import {
  formatMorningDigest,
  MorningDigestInput,
  MorningIncident,
} from '../morning-digest.formatter';
import { formatTradeDay } from '../paper-number.formatter';
import { PORTFOLIO_PUBLISH_FAILURE_HEADER } from './portfolio-publish.autopilot-task';

// 환율을 저장하는 것은 저녁 감시라 아침에는 늘 어제 값이 최신이다. 연휴를 감안해도 이만큼
// 묵었으면 환산이 자산 규모를 왜곡하므로, 그때는 자산 줄 자체를 내지 않는다.
const MAXIMUM_FX_RATE_AGE_DAYS = 7;
// 잔고 동기화가 멈춘 채 며칠 지나면 수량 자체가 옛것이다. 평가액은 계산되지만 그것은
// 지금 자산이 아니다 — 환율에 상한을 둔 것과 같은 이유로 그때는 줄을 내지 않는다.
const MAXIMUM_HOLDING_AGE_DAYS = 7;

// 마감 줄이 내다보는 앞쪽 폭. 이보다 먼 마감은 오늘 아침에 할 일이 아니다.
const UPCOMING_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const ageInDaysOf = (date: Date): number =>
  (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);

// 열린 사건 중 이 기간 안에 다시 실패한 것만 할 일로 올린다. 해결 신호가 영영 오지 않는
// 사건(폐지된 task 등)이 매일 "N일째" 로 남지 않게 하는 상한이다.
// ponytail: 주 1회 도는 task 의 사건은 7일을 넘기면 빠진다. 그런 사건이 생기면 task 주기별 창으로 바꾼다.
const INCIDENT_SEEN_WINDOW_DAYS = 7;
// 마지막 수집이 이보다 오래면 "새 공고 없음" 이 아니라 수집 정지로 본다 — 조회 계층의 신선도
// 조건(이틀)과 같은 폭이다(job-feed.autopilot-task.ts 의 lastCollectedAt 주석).
const STALE_COLLECTION_MS = 48 * 60 * 60 * 1000;
// 어제 23시 포트폴리오 보고를 찾는 창. 아침 08:30 기준 그 전날 밤까지만 본다.
const PORTFOLIO_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const PORTFOLIO_LINE_MAX_LENGTH = 150;
// 장애 줄에 실을 실패 사유 길이. 전문은 원장·로그에 있다.
const FAILURE_REASON_MAX_LENGTH = 80;
const PORTFOLIO_TASK_ID = 'portfolio-publish';
const APPROVAL_LABEL_MAX_LENGTH = 20;
const THREAD_SEPARATOR = '\n\n────────\n\n';

const isWeekendKst = (firedAtKst: string): boolean => {
  const day = new Date(`${firedAtKst}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
};

// 승인 대기 줄에 적을 카드 이름. 첫 줄만 보고 무엇인지 알 수 있는 짧은 이름이어야 한다.
const APPROVAL_KIND_LABEL: Partial<Record<string, string>> = {
  [PREVIEW_KIND.EVENING_BLOG_PUBLISH]: '블로그 후보',
  [PREVIEW_KIND.EVENING_CAREER_REFLECT]: '경력 반영',
  [PREVIEW_KIND.BLOG_GITHUB_PUBLISH]: 'GitHub 발행',
  [PREVIEW_KIND.STUDY_APPLY_ISSUE]: '공부 적용',
};

const toApprovalLabel = (preview: PreviewAction): string => {
  const known = APPROVAL_KIND_LABEL[preview.kind];
  if (known) {
    return known;
  }
  // 이름표가 없는 카드는 첫 줄 앞부분으로 대신한다 — 굵게·이모지 표기는 걷어 낸다.
  const firstLine = (preview.previewText.split('\n')[0] ?? '')
    .replace(/[*_~`]/g, '')
    .trim();
  if (firstLine.length === 0) {
    return '승인 카드';
  }
  return firstLine.length <= APPROVAL_LABEL_MAX_LENGTH
    ? firstLine
    : `${firstLine.slice(0, APPROVAL_LABEL_MAX_LENGTH)}…`;
};

// KST 달력일(YYYY-MM-DD). Date 를 넘기므로 formatKstDate 의 파싱 실패 분기(null)는 오지 않는다.
const getKstDateOf = (date: Date): string =>
  formatKstDate(date.toISOString()) ?? date.toISOString().slice(0, 10);

const truncate = (text: string, maxLength: number): string =>
  text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;

type PortfolioReport =
  | { kind: 'report'; line: string }
  | { kind: 'failure'; reason: string };

// 콘솔 원장에 남은 포트폴리오 발행 보고(요약 + 상세 전문)를 읽는다. 발행이 통째로 실패한 회차는
// 불릿 없이 실패 머리 한 줄이라, 불릿만 주우면 유일한 실패 보고가 사라진다 — 머리로 먼저 가른다.
const readPortfolioReport = (fullText: string): PortfolioReport | null => {
  const summaryPart = fullText.split('\n\n')[0] ?? '';
  if (summaryPart.startsWith(PORTFOLIO_PUBLISH_FAILURE_HEADER)) {
    const reason = summaryPart
      .slice(PORTFOLIO_PUBLISH_FAILURE_HEADER.length)
      .replace(/^\s*—\s*/, '')
      .trim();
    return { kind: 'failure', reason };
  }
  const bullets = summaryPart
    .split('\n')
    .filter((line) => line.startsWith('• '))
    .map((line) => line.slice(2).trim());
  if (bullets.length === 0) {
    return null;
  }
  return {
    kind: 'report',
    // 불릿 안의 " — " 와 장식 이모지를 그대로 이으면 "발행 — 📋 이력서 감사 — 약함…" 처럼 대시가 겹친다.
    // ⚠️ 는 경고 표시라 남긴다.
    line: truncate(
      `발행 · ${bullets
        .map((bullet) =>
          bullet.replace(/^(📋|📌)\s*/u, '').replace(/ — /g, ': '),
        )
        .join(' · ')}`,
      PORTFOLIO_LINE_MAX_LENGTH,
    ),
  };
};

interface PlanSection {
  // 스레드에 실을 계획 전문(지금까지 메인에 있던 요약 + 상세).
  thread: string;
  company: TaskItem | null;
  // 계획 생성이 실패했으면 그 사유. 아침 메시지 본체는 그대로 나가고 이것만 장애 줄로 오른다.
  failure: string | null;
}

interface PostingSection {
  postings: StoredJobPosting[] | null;
  // 공고 수집이 멈춘 것 같으면 장애 줄 문구. 새 공고 0건과 수집 정지를 구분한다 — job-feed
  // 메시지의 각주가 하던 일을 여기서 이어받는다.
  staleIncident: MorningIncident | null;
  thread: string | null;
}

// 아침 한 통 — 매일 08:30 KST. 할 일(승인 대기·장애·새 공고)을 맨 위에, 투자·회사·공부·
// 어제 포트폴리오를 한 줄씩 둔다(docs/superpowers/plans/2026-10-08-daily-message-direction.md §3-1).
// PM 계획 전문과 공고 목록은 스레드로 내린다.
//
// 이 task id 는 바꾸지 않는다 — 저녁 회고의 pm_plan 판정 버튼이 아침 발송 원장의 itemKinds 에
// `morning-briefing` 이 있어야 붙는다(evening-retro-publish.autopilot-task.ts findTodayPmPlanVerdict).
// 같은 묶음의 비서실은 콘솔 경로라 채널에 나가는 요약은 이것 하나다.
//
// 공고 알림 선점은 여기 onDelivered 가 맡는다 — job-feed(07:00)는 수집·채점만 하고 선점하지 않는다.
// 발송은 오케스트레이터(T0)가 담당 — 여기선 텍스트만 만든다.
@Injectable()
export class MorningBriefingAutopilotTask implements AutopilotTask {
  readonly id = 'morning-briefing';
  private readonly logger = new Logger(MorningBriefingAutopilotTask.name);

  constructor(
    private readonly generateDailyPlan: GenerateDailyPlanUsecase,
    private readonly humanizeService: HumanizeService,
    private readonly stockRepository: StockMonitorPrismaRepository,
    private readonly listSchedules: ListSchedulesUsecase,
    private readonly findAllOpenPreviews: FindAllOpenPreviewsUsecase,
    private readonly listNotifiable: ListNotifiablePostingsUsecase,
    @Inject(JOB_POSTING_REPOSITORY_PORT)
    private readonly jobPostingRepository: JobPostingRepositoryPort,
    @Inject(DAILY_DIGEST_REPOSITORY_PORT)
    private readonly digestRepository: DailyDigestRepositoryPort,
    private readonly configService: ConfigService,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const now = new Date();
    const plan = await this.buildPlanSection(ownerSlackUserId);
    const [approvalLabels, incidents, posting, invest, study, portfolio] =
      await Promise.all([
        this.loadApprovalLabels(ownerSlackUserId, now),
        this.loadIncidents(now),
        this.loadPostings(firedAtKst, now),
        this.loadInvest(firedAtKst),
        this.loadStudy(
          // 브리프는 별도 cron 이 자기 owner 로 저장한다(study-brief-cron.scheduler.ts). 두 owner 설정이
          // 갈라지면 autopilot owner 로는 브리프를 못 찾아 공부 줄이 조용히 빠지므로, 생산자의 키를 먼저 쓴다.
          this.configService
            .get<string>('STUDY_BRIEF_OWNER_SLACK_USER_ID')
            ?.trim() || ownerSlackUserId,
        ),
        this.loadPortfolio(now),
      ]);

    // 그날 회차에서 감지한 문제도 장애로 센다 — 첫 줄만 보고 열지 정하는 메시지라, 아래 줄에만
    // 경고를 두면 첫 줄이 "손댈 것 없음" 인 채로 문제가 묻힌다.
    const detectedIncidents: MorningIncident[] = [
      ...(plan.failure
        ? [{ label: `오늘 계획 생성 실패 — ${plan.failure}`, dayCount: null }]
        : []),
      ...(posting.staleIncident ? [posting.staleIncident] : []),
      ...(portfolio?.kind === 'failure'
        ? [
            {
              label: `포트폴리오 사이트 발행 실패 — ${truncate(portfolio.reason, FAILURE_REASON_MAX_LENGTH)}`,
              dayCount: null,
            },
          ]
        : []),
    ];
    const digestInput: MorningDigestInput = {
      firedAtKst,
      approvalLabels,
      incidents: [...incidents, ...detectedIncidents],
      postings: posting.postings,
      invest,
      company: plan.company
        ? { title: plan.company.title, url: plan.company.url ?? null }
        : null,
      study,
      portfolio: portfolio?.kind === 'report' ? portfolio.line : null,
    };
    const postings = posting.postings ?? [];

    return {
      skip: false,
      summaryText: formatMorningDigest(digestInput),
      detailText: [plan.thread, posting.thread]
        .filter((part): part is string => Boolean(part))
        .join(THREAD_SEPARATOR),
      // PM 계획 전문은 이제 스레드에만 있다. 스레드가 실패하면 채널에 대신 붙인다(중복 > 유실).
      detailIsOnlyCopy: true,
      // 공고 링크가 스레드에, 계획 링크가 본문에 실린다 — 미리보기가 펼쳐지면 한 줄씩 둔 목적이 묻힌다.
      unfurlLinks: false,
      // 선점은 공고 목록(스레드)이 실제로 나간 뒤에만 — 스레드가 실패하면 오케스트레이터가
      // 이 콜백을 건너뛰어 다음 날 같은 공고가 다시 뜬다(중복 > 유실).
      ...(postings.length > 0
        ? { onDelivered: async (): Promise<void> => this.claim(postings) }
        : {}),
    };
  }

  private async buildPlanSection(
    ownerSlackUserId: string,
  ): Promise<PlanSection> {
    try {
      const outcome = await this.generateDailyPlan.execute({
        tasksText: '',
        slackUserId: ownerSlackUserId,
        triggerType: TriggerType.MORNING_BRIEFING_CRON,
      });
      const humanizedPlan = await humanizeDailyPlan(
        outcome.result.plan,
        this.humanizeService,
      );
      const formatted = formatDailyPlan(
        humanizedPlan,
        outcome.result.inputTruncation,
      );
      const planSummary = await this.appendUpcomingSchedules(
        await this.appendPortfolioValue(
          formatted.summary + formatWaitingSection(outcome.result.waitingItems),
        ),
        ownerSlackUserId,
      );
      return {
        thread: `${planSummary}\n\n${formatted.detail}${formatModelFooter(outcome)}`,
        company: humanizedPlan.topPriority,
        failure: null,
      };
    } catch (error) {
      if (
        error instanceof PmAgentException &&
        error.pmAgentErrorCode === PmAgentErrorCode.EMPTY_TASKS_INPUT
      ) {
        // 할 일이 없는 날에도 자산과 마감은 말해 준다 — 할 일이 없는 날이야말로 마감 알림이
        // 가장 필요한 날이다. 그 안내는 계획 전문 자리(스레드)에 그대로 둔다.
        const emptyTasksText = await this.appendUpcomingSchedules(
          await this.appendPortfolioValue(
            '오늘 자동 수집된 할 일이 없습니다 (GitHub/Notion/Slack 모두 비어있음). 필요하면 `/today <할 일>` 로 직접 입력해주세요.',
          ),
          ownerSlackUserId,
        );
        return { thread: emptyTasksText, company: null, failure: null };
      }
      // 계획 생성 실패가 아침 메시지 전체를 지우면 안 된다 — 승인 대기·장애·공고·공부·포트폴리오는
      // 계획과 무관한 정보이고, 그 원래 발송은 콘솔로 옮겨져 이 메시지가 유일한 표면이다.
      // 실패는 PM 실행 원장(FAILED)에 남고, 여기서는 장애 줄로 올린다.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `아침 계획 생성 실패 — 나머지 줄은 그대로 발송: ${reason}`,
      );
      return {
        thread: `_⚠️ 오늘 계획을 만들지 못했습니다 — ${reason}_`,
        company: null,
        failure: truncate(reason, FAILURE_REASON_MAX_LENGTH),
      };
    }
  }

  // 아래 조회는 모두 곁다리다. 하나가 실패해도 아침 메시지 본체는 나가야 한다 — 실패한 줄만 빠진다.
  private async loadApprovalLabels(
    ownerSlackUserId: string,
    now: Date,
  ): Promise<string[]> {
    try {
      const previews = await this.findAllOpenPreviews.execute({ now });
      // 승인 경로가 slackUserId 를 검사하므로 owner 카드만 할 일이다(secretariat 와 같은 기준).
      return previews
        .filter((preview) => preview.slackUserId === ownerSlackUserId)
        .map(toApprovalLabel);
    } catch (error: unknown) {
      this.logger.warn(`승인 대기 조회 실패 — 줄 생략: ${String(error)}`);
      return [];
    }
  }

  private async loadIncidents(now: Date): Promise<MorningIncident[]> {
    try {
      const rows = await this.digestRepository.findOpenIncidents({
        seenSince: new Date(now.getTime() - INCIDENT_SEEN_WINDOW_DAYS * DAY_MS),
      });
      return rows.map((row) => ({
        label: row.label,
        dayCount: countKstDaysBetween(row.openedAt, now) + 1,
      }));
    } catch (error: unknown) {
      this.logger.warn(`열린 장애 조회 실패 — 줄 생략: ${String(error)}`);
      return [];
    }
  }

  private async loadPostings(
    firedAtKst: string,
    now: Date,
  ): Promise<PostingSection> {
    // 미설정이면 꺼진 상태가 기본이다(job-feed 와 같은 스위치).
    if (this.configService.get<string>('JOB_FEED_ENABLED') !== 'true') {
      return { postings: null, staleIncident: null, thread: null };
    }
    try {
      const postings = await this.listNotifiable.execute({
        threshold:
          this.configService.get<number>('JOB_FEED_MATCH_THRESHOLD') ??
          DEFAULT_JOB_MATCH_THRESHOLD,
        limit: DEFAULT_JOB_NOTIFY_LIMIT,
        // 사전 불일치 경고는 job-feed 가 07:00 에 이미 남긴다 — 여기서는 걸러진 목록만 쓴다.
        avoidSkillTags: parseAvoidSkillTags(
          this.configService.get<string>('JOB_FEED_AVOID_SKILLS'),
        ).identified,
      });
      const lastCollectedAt =
        await this.jobPostingRepository.findLastCollectedAt();
      // 수집은 평일만 돈다(DEFAULT_JOB_FEED_CRON). 주말 아침에는 금요일 수집이 이틀을 넘겨
      // 늘 "멈춤" 으로 보이므로 판정하지 않는다 — 평일 아침에는 그날 07:00 회차가 이미 돌았어야 한다.
      const isStale =
        !isWeekendKst(firedAtKst) &&
        (lastCollectedAt === null ||
          now.getTime() - lastCollectedAt.getTime() > STALE_COLLECTION_MS);
      const { detail } = formatJobFeedDigest({
        postings,
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt,
        firedAtKst,
      });
      return {
        postings,
        staleIncident: isStale
          ? {
              label: lastCollectedAt
                ? `공고 수집 멈춤 — 마지막 수집 ${formatTradeDay(getKstDateOf(lastCollectedAt))}`
                : '공고 수집된 적 없음 — 수집 설정 확인',
              dayCount: null,
            }
          : null,
        thread: detail
          ? `*새 백엔드 공고 ${postings.length}건*\n${detail}`
          : null,
      };
    } catch (error: unknown) {
      this.logger.warn(`공고 조회 실패 — 줄 생략: ${String(error)}`);
      return { postings: null, staleIncident: null, thread: null };
    }
  }

  private async loadInvest(
    firedAtKst: string,
  ): Promise<MorningDigestInput['invest']> {
    try {
      const counts = await this.digestRepository.countDuePaperOrders({
        // targetTradeDate 는 @db.Date 라 UTC 자정으로 맞춘다(체결기와 같은 표현).
        tradeDate: new Date(`${firedAtKst}T00:00:00.000Z`),
      });
      return counts.buyCount + counts.sellCount > 0 ? counts : null;
    } catch (error: unknown) {
      this.logger.warn(`모의투자 예정 조회 실패 — 줄 생략: ${String(error)}`);
      return null;
    }
  }

  private async loadStudy(
    ownerSlackUserId: string,
  ): Promise<MorningDigestInput['study']> {
    try {
      const brief = await this.digestRepository.findLatestStudyBrief({
        ownerUserId: ownerSlackUserId,
        since: getKstDayStartAsUtc(),
      });
      return brief ? { topic: brief.topic, url: brief.notionUrl } : null;
    } catch (error: unknown) {
      this.logger.warn(`오늘의 공부 조회 실패 — 줄 생략: ${String(error)}`);
      return null;
    }
  }

  private async loadPortfolio(now: Date): Promise<PortfolioReport | null> {
    try {
      const text = await this.digestRepository.findLatestConsoleText({
        itemKind: PORTFOLIO_TASK_ID,
        since: new Date(now.getTime() - PORTFOLIO_LOOKBACK_MS),
      });
      return text ? readPortfolioReport(text) : null;
    } catch (error: unknown) {
      this.logger.warn(`포트폴리오 보고 조회 실패 — 줄 생략: ${String(error)}`);
      return null;
    }
  }

  private async claim(postings: StoredJobPosting[]): Promise<void> {
    const claimedAt = new Date();
    let failed = 0;
    // 발송은 이미 끝났다 — 한 건의 선점 실패로 나머지를 포기하면, 메시지에는 이미 나갔는데
    // 표식만 안 남은 공고가 다음 날 다시 뜬다. 건별로 격리해 최대한 많이 선점한다.
    for (const posting of postings) {
      try {
        await this.jobPostingRepository.claimForNotification(
          posting.normalizedKey,
          claimedAt,
        );
      } catch (error: unknown) {
        failed += 1;
        this.logger.warn(
          `공고 알림 선점 실패 — ${posting.normalizedKey}: ${String(error)}`,
        );
      }
    }
    if (failed > 0) {
      this.logger.warn(
        `공고 알림 선점 — ${postings.length}건 중 ${failed}건 실패, 내일 다시 뜰 수 있음`,
      );
    }
  }

  // 자산 한 줄은 브리핑의 곁다리다. 조회가 실패해도 브리핑 본체는 나가야 한다 —
  // 장식 쿼리 하나가 본체를 죽이는 것을 이 레포에서 이미 겪었다.
  private async appendPortfolioValue(summaryText: string): Promise<string> {
    try {
      const positions = await this.stockRepository.findPortfolioPositions();
      if (positions.length === 0) {
        return summaryText;
      }
      const holdingAgeDays = Math.min(
        ...positions.map((position) => ageInDaysOf(position.holdingDate)),
      );
      if (holdingAgeDays > MAXIMUM_HOLDING_AGE_DAYS) {
        this.logger.warn(
          `잔고가 ${Math.floor(holdingAgeDays)}일 전 값이라 자산 요약을 생략합니다.`,
        );
        return summaryText;
      }
      const rate = await this.resolveUsdKrwRate();
      const value = summarizePortfolioValue(positions, rate);
      const valueText = formatPortfolioValue(value);
      if (!valueText) {
        return summaryText;
      }
      return `${summaryText}\n\n${valueText}`;
    } catch (error) {
      this.logger.warn(`자산 요약 생략 — ${(error as Error).message}`);
      return summaryText;
    }
  }

  // 마감 한 줄도 자산 줄과 같은 곁다리다. 조회가 실패해도 브리핑 본체는 나가야 한다 —
  // 장식이 본체를 죽이면 안 된다.
  private async appendUpcomingSchedules(
    text: string,
    ownerSlackUserId: string,
  ): Promise<string> {
    // **하한(`from`)을 넘기지 않는다.** 오늘을 하한으로 두면 어제 놓친 미완 마감이 조회에서
    // 통째로 빠져, 처리도 건너뜀도 안 한 항목이 조용히 사라진다 — 놓친 마감을 알리는 것이
    // 이 기능의 목적이라 그 하한이 목적을 거스른다. 포맷터의 `D+n`(지난 마감) 분기가
    // 프로덕션에서 도달 불가였던 것도 같은 이유다(`schedule-briefing.formatter.ts`).
    // 임의의 되짚기 폭(예: 90일)을 두지 않은 것은 그 경계 밖에서 같은 실종이 되살아나서다.
    //
    // 상한(`to`)은 **KST 달력일의 UTC 자정** 에 맞춘다. `dueDate` 가 `@db.Date` 라 같은
    // 표현이어야 라벨 반올림이 어긋나지 않는다 — 시각이 붙으면 밤에 내일 마감이 `D-day` 로
    // 찍힌다(2026-09-18 실측).
    //
    // 완료·건너뜀은 여기서 거르지 않는다 — `formatUpcomingLine` 이 `OPEN` 만 남기므로
    // 거르는 자리를 둘로 늘리면 둘이 갈릴 때 어느 쪽이 정본인지 알 수 없어진다.
    const todayCalendarDay = plainDateToUtcDate(todayInKst(new Date()));
    const weekLater = new Date(
      todayCalendarDay.getTime() + UPCOMING_WINDOW_DAYS * DAY_MS,
    );
    try {
      const items = await this.listSchedules.execute({
        slackUserId: ownerSlackUserId,
        to: weekLater,
      });
      return text + formatUpcomingLine(items, todayCalendarDay);
    } catch (error: unknown) {
      this.logger.warn(`마감 줄 생성 실패: ${String(error)}`);
      return text;
    }
  }

  private async resolveUsdKrwRate(): Promise<Prisma.Decimal | null> {
    const stored = await this.stockRepository.findLatestFxRate(USD_KRW_PAIR);
    if (!stored) {
      return null;
    }
    const ageDays = ageInDaysOf(stored.rateDate);
    if (ageDays > MAXIMUM_FX_RATE_AGE_DAYS) {
      this.logger.warn(
        `환율이 ${Math.floor(ageDays)}일 전 값이라 자산 요약에 쓰지 않습니다.`,
      );
      return null;
    }
    return new Prisma.Decimal(stored.rate);
  }
}
