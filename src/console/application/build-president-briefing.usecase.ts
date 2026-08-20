import { Inject, Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import {
  formatKstDate,
  getKstDayStartAsUtc,
  getTodayKstDate,
} from '../../common/util/kst-date.util';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  OpenPostedPullRequestRow,
  PR_REVIEW_FINDING_REPOSITORY_PORT,
  PrReviewFindingRepositoryPort,
} from '../../pr-review-loop/domain/port/pr-review-finding.repository.port';
import { FindAllOpenPreviewsUsecase } from '../../preview-gate/application/find-all-open-previews.usecase';
import { FindPreviewDayOutcomesUsecase } from '../../preview-gate/application/find-preview-day-outcomes.usecase';
import { PreviewAction } from '../../preview-gate/domain/preview-action.type';
import {
  ConsoleBriefing,
  ConsoleDailyReport,
  ConsoleTodo,
  ConsoleTodoKind,
} from '../domain/briefing.type';
import { calculateStreak, CardDayOutcome } from '../domain/streak';

const DAY_MS = 24 * 60 * 60 * 1000;
// 워커의 평소 주기를 재는 창. `SuggestNextWorkUsecase` 와 같은 값을 쓴다 — 같은 원장에서
// 같은 질문("이 워커는 며칠에 한 번 도나")을 하므로 창이 다르면 두 화면이 다른 답을 낸다.
const CYCLE_HISTORY_DAYS = 60;
const CYCLE_HISTORY_LIMIT = 300;
// 하루 평균 이만큼 이상 도는 워커는 스스로 살아난다고 본다. 실측상 하루 1회 워커는 다음날
// 정규 슬롯(약 24시간 뒤)에 복구되고, 여러 번 도는 워커는 몇 분 안에 복구된다.
const RUNS_PER_DAY_SELF_HEALING = 2;

interface FailedAgentCandidate {
  readonly agentType: string;
  readonly medianIntervalDays: number;
}

/**
 * 대표 머리 위 할 일 말풍선·연속 기록·퇴근 정산의 재료를 한 번에 조립한다.
 *
 * **스냅샷(`ConsoleReadService`)에 얹지 않는다.** 갱신 주기가 다르고(스냅샷은 부팅 1회 뒤 SSE
 * 증분), 집계가 실패해도 관제 화면은 살아 있어야 한다. 앱은 이 엔드포인트를 따로 폴링한다.
 *
 * 새로 만든 조회는 둘뿐이다. "오늘 실패하고 아직 못 살아난 워커" 는 스냅샷 복원이 쓰는
 * `findRecentlyFinishedRuns`(agentType 별 최신 종료)를 자정 기준으로 부르면 그대로 나오고,
 * "미회수 리뷰" 는 수확 스윕이 쓰는 `findOpenPostedCards` 가 이미 같은 조건이다.
 */
@Injectable()
export class BuildPresidentBriefingUsecase {
  private readonly logger = new Logger(BuildPresidentBriefingUsecase.name);

  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly findAllOpenPreviews: FindAllOpenPreviewsUsecase,
    private readonly findPreviewDayOutcomes: FindPreviewDayOutcomesUsecase,
    @Inject(PR_REVIEW_FINDING_REPOSITORY_PORT)
    private readonly findingRepository: PrReviewFindingRepositoryPort,
  ) {}

  async execute(): Promise<ConsoleBriefing> {
    const now = new Date();
    const dayStart = getKstDayStartAsUtc();

    const [
      openPreviews,
      dayOutcomes,
      finishedToday,
      succeededToday,
      failedToday,
      openPulls,
    ] = await Promise.all([
      this.findAllOpenPreviews.execute({ now }),
      this.findPreviewDayOutcomes.execute(),
      // 자정 경계는 절대 시각으로 넘긴다. 상대 분으로 주면 리포지토리가 자기 시각에서
      // 다시 빼면서 경계가 최대 1분 앞당겨져, 어제 23:59 에 엎어진 워커가 "오늘 실패" 로
      // 섞인다.
      this.agentRunService.findRecentlyFinishedRuns({
        withinMinutes: 0,
        since: dayStart,
      }),
      this.agentRunService.countSucceededSince({ since: dayStart }),
      this.agentRunService.countFailedSince({ since: dayStart }),
      this.findOpenReviewPulls(),
    ]);

    const streak = calculateStreak(
      toCardDayOutcomes(dayOutcomes),
      getTodayKstDate(),
    );
    const stuckAgents = await this.findStuckAgents(finishedToday);
    const todos = [
      ...buildApprovalTodo(openPreviews),
      ...buildFailedRunTodo(stuckAgents),
      ...buildReviewTodo(openPulls),
    ];

    return {
      todos,
      streak,
      dailyReport: {
        date: getTodayKstDate(),
        succeeded: succeededToday.reduce((sum, row) => sum + row.succeeded, 0),
        failed: failedToday,
        approvalsOpened: streak.todayOpened,
        approvalsHandled: streak.todayOpened - streak.todayRemaining,
        pendingReviewPulls: openPulls.length,
      } satisfies ConsoleDailyReport,
      serverTime: now.toISOString(),
    };
  }

  /**
   * 오늘 실패했고 **오늘 안에 다시 돌지 않는** 워커만 고른다.
   *
   * 실패 자체는 할 일이 아니다. 재시도는 이미 자동으로 돌고(BullMQ attempts + 다음 정규 슬롯),
   * 원장 실측상 최근 20일 실패 25건이 전부 사람 손 없이 복구됐다. 5분마다 도는 스윕이
   * 엎어진 것을 대표가 눌러 봐야 몇 분 아낄 뿐이다.
   *
   * 값어치가 있는 것은 다음 실행이 내일인 워커다 — PM 이 아침에 엎어지면 오늘 계획이 통째로
   * 빈다. 주기는 `SuggestNextWorkUsecase` 와 같은 방식(성공한 KST 날짜 사이 간격의 중앙값)으로
   * 잰다.
   */
  private async findStuckAgents(
    finishedToday: readonly { agentType: string; status: string }[],
  ): Promise<FailedAgentCandidate[]> {
    const failedAgentTypes = finishedToday
      .filter((run) => run.status === 'FAILED')
      .map((run) => run.agentType);
    const candidates = await Promise.all(
      failedAgentTypes.map(async (agentType) => {
        const medianIntervalDays = await this.measureCycleDays(agentType);
        // 주기를 모르면(성공 이력이 2일 미만) 판단할 근거가 없다. 띄우지 않는다 —
        // 근거 없는 재촉은 보드의 신뢰를 깎는다.
        if (medianIntervalDays === null || medianIntervalDays < 1) {
          return null;
        }
        return { agentType, medianIntervalDays };
      }),
    );
    return candidates.filter(
      (candidate): candidate is FailedAgentCandidate => candidate !== null,
    );
  }

  private async measureCycleDays(agentType: string): Promise<number | null> {
    try {
      const runs = await this.agentRunService.findRecentSucceededRuns({
        agentType: agentType as AgentType,
        sinceDays: CYCLE_HISTORY_DAYS,
        limit: CYCLE_HISTORY_LIMIT,
      });
      const dates = runs
        .map((run) => formatKstDate(run.endedAt.toISOString()))
        .filter((date): date is string => date !== null);
      const succeededDates = [...new Set(dates)].sort((left, right) =>
        right.localeCompare(left),
      );
      if (succeededDates.length < 2) {
        return null;
      }
      // **하루에 여러 번 도는 워커를 여기서 걸러낸다.**
      //
      // 날짜 단위 중앙값만 보면 5분마다 도는 스윕도 "1일 주기" 로 나온다 — 매일 성공하니
      // 날짜 간격이 1일이다. 그대로 두면 그 스윕이 엎어질 때마다 화면에 "재시도" 가 뜨는데,
      // 몇 분 뒤 다음 회차가 알아서 살린다(원장 실측: CODE_REVIEWER 복구까지 2~12분).
      //
      // 하루 평균 실행 횟수로 가른다. 오늘 안에 또 돌 워커는 대표가 손댈 일이 아니다.
      const runsPerDay = dates.length / succeededDates.length;
      if (runsPerDay >= RUNS_PER_DAY_SELF_HEALING) {
        return null;
      }
      return calculateMedianIntervalDays(succeededDates);
    } catch (error) {
      this.logger.warn(
        `워커 주기 계산 실패 — ${agentType} 은 할 일 후보에서 제외한다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * 아직 반응이 없는 리뷰 지적이 남은 PR 목록. 오래 방치된 것부터.
   *
   * 수확 스윕의 `findOpenPostedCards` 를 쓰지 않는다 — 그쪽은 한 회차 처리량을 묶으려고
   * 최근 20개 PR 로 자르므로, 가장 오래 방치된 PR 이 그 밖에 있으면 통째로 빠진다.
   * 브리핑은 바로 그것을 골라 보여주는 화면이라 전건 집계를 따로 쓴다.
   */
  private async findOpenReviewPulls(): Promise<OpenPostedPullRequestRow[]> {
    const rows = await this.findingRepository.countOpenPostedByPullRequest();
    return [...rows].sort(
      (left, right) => left.oldestAt.getTime() - right.oldestAt.getTime(),
    );
  }
}

const toCardDayOutcomes = (
  rows: readonly { createdAt: Date; closedAt: Date | null }[],
): CardDayOutcome[] =>
  rows.flatMap((row): CardDayOutcome[] => {
    const openedDate = formatKstDate(row.createdAt.toISOString());
    if (openedDate === null) {
      return [];
    }
    return [
      {
        openedDate,
        closedDate:
          row.closedAt === null
            ? null
            : formatKstDate(row.closedAt.toISOString()),
      },
    ];
  });

// 승인은 건수와 무관하게 한 줄이다. 급한 정도는 가장 먼저 만료되는 카드가 정한다.
const buildApprovalTodo = (
  previews: readonly PreviewAction[],
): ConsoleTodo[] => {
  if (previews.length === 0) {
    return [];
  }
  const soonest = previews.reduce((earliest, preview) =>
    preview.expiresAt < earliest.expiresAt ? preview : earliest,
  );
  return [
    {
      kind: ConsoleTodoKind.APPROVAL,
      label: `승인 ${previews.length}건`,
      detail: `${formatKstTime(soonest.expiresAt)} 만료`,
    },
  ];
};

const buildFailedRunTodo = (
  candidates: readonly FailedAgentCandidate[],
): ConsoleTodo[] => {
  if (candidates.length === 0) {
    return [];
  }
  const [first] = candidates;
  const label =
    candidates.length === 1
      ? `${first.agentType} 재시도`
      : `실패한 실행 ${candidates.length}건 재시도`;
  return [
    {
      kind: ConsoleTodoKind.FAILED_RUN,
      label,
      detail:
        first.medianIntervalDays >= 2
          ? `다음 실행은 ${first.medianIntervalDays}일 뒤`
          : '다음 실행은 내일',
    },
  ];
};

const buildReviewTodo = (
  pulls: readonly OpenPostedPullRequestRow[],
): ConsoleTodo[] => {
  if (pulls.length === 0) {
    return [];
  }
  const [oldest] = pulls;
  const label =
    pulls.length === 1
      ? `PR #${oldest.pullNumber} 리뷰 회수`
      : `PR 리뷰 회수 ${pulls.length}건`;
  const days = Math.floor((Date.now() - oldest.oldestAt.getTime()) / DAY_MS);
  return [
    {
      kind: ConsoleTodoKind.PR_REVIEW,
      label,
      detail: days >= 1 ? `${days}일째` : '오늘',
    },
  ];
};

const KST_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
});

const formatKstTime = (date: Date): string => KST_TIME_FORMATTER.format(date);

// 성공한 날짜(최신순) 사이 간격의 중앙값. `SuggestNextWorkUsecase` 와 같은 계산이다.
const calculateMedianIntervalDays = (dates: readonly string[]): number => {
  const intervals = dates
    .slice(0, -1)
    .map((date, index) => differenceInCalendarDays(dates[index + 1], date))
    .sort((left, right) => left - right);
  const middleIndex = Math.floor(intervals.length / 2);
  if (intervals.length % 2 === 1) {
    return intervals[middleIndex];
  }
  return (intervals[middleIndex - 1] + intervals[middleIndex]) / 2;
};

// YYYY-MM-DD 는 UTC 자정으로 파싱되므로 서버 로컬 timezone 과 무관하게 캘린더 일수를 센다.
const differenceInCalendarDays = (earlier: string, later: string): number =>
  (Date.parse(later) - Date.parse(earlier)) / DAY_MS;
