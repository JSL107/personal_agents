import { Inject, Injectable, Logger } from '@nestjs/common';

import { formatKstDate } from '../../../common/util/kst-date.util';
import {
  HOLIDAY_CALENDAR_PORT,
  HolidayCalendarPort,
} from '../../../holiday/domain/port/holiday-calendar.port';
import { escapeSlackMrkdwn } from '../../../slack/format/mrkdwn.util';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';
import {
  CUJ_THRESHOLDS,
  CujViolation,
  detectApprovalViolations,
  detectEveningReviewViolations,
  detectMentionViolations,
  detectMorningBriefingViolations,
  detectPaperInvestmentViolations,
  detectPrReviewViolations,
} from '../../domain/cuj-check';
import {
  CUJ_LEDGER_READER_PORT,
  CujLedgerReaderPort,
} from '../../domain/port/cuj-ledger.reader.port';

const DAY_MS = 24 * 60 * 60 * 1000;
const POSTING_GRACE_MS = 10 * 60 * 1000;
const CUJ_TITLES = [
  'PR 리뷰',
  '아침 브리핑',
  '퇴근 회고·평가',
  '모의투자',
  '멘션 대화',
  '승인 반영',
];

@Injectable()
export class CujCheckAutopilotTask implements AutopilotTask {
  readonly id = 'cuj-check';
  private readonly logger = new Logger(CujCheckAutopilotTask.name);

  constructor(
    @Inject(CUJ_LEDGER_READER_PORT)
    private readonly reader: CujLedgerReaderPort,
    @Inject(HOLIDAY_CALENDAR_PORT)
    private readonly holidays: HolidayCalendarPort,
  ) {}

  async run({
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const now = new Date();
    // 날짜 판정 창은 회차 날짜(firedAtKst)에서 잡는다. 지금 시각으로 잡으면 늦게 돈 회차나
    // 재실행이 판정 날짜와 다른 날의 원장을 읽어 거짓 경보를 낸다.
    const todayStart = new Date(`${firedAtKst}T00:00:00+09:00`);
    const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
    const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
    const yesterdayText = formatKstDate(yesterdayStart.toISOString()) ?? '';
    const todayUntil = now < tomorrowStart ? now : tomorrowStart;
    // 24시간 누적 지표(실패·지연·반영 실패)는 지금 시각 기준 최근 24시간이다.
    const since = new Date(now.getTime() - DAY_MS);
    // 방금 만든 지적은 아직 게시 중일 수 있어 최근 10분은 뺀다.
    const postedBy = new Date(now.getTime() - POSTING_GRACE_MS);
    const violations: CujViolation[] = [];

    await this.checkSafely(1, violations, async () =>
      detectPrReviewViolations(
        await this.reader.readPrReviews(since, now),
        await this.reader.countUnpostedFindings(since, postedBy),
      ),
    );
    await this.checkSafely(2, violations, async () =>
      detectMorningBriefingViolations(
        await this.reader.readDeliveries(todayStart, todayUntil),
        firedAtKst,
      ),
    );
    await this.checkSafely(3, violations, async () =>
      detectEveningReviewViolations(
        await this.reader.readDeliveries(yesterdayStart, todayStart),
        yesterdayText,
      ),
    );
    await this.checkSafely(4, violations, async () => {
      const calendar = await this.holidays.load();
      const runs = await this.reader.readPaperRecommendations(
        yesterdayStart,
        todayStart,
      );
      const orders = await this.reader.readPendingOrders(todayStart);
      return detectPaperInvestmentViolations(
        runs,
        orders,
        yesterdayText,
        calendar,
      );
    });
    // 수신 기록은 아직 처리 중일 수 있는 최근 기한만큼 뺀다. 하한도 같은 폭으로 당겨야 직전 회차가
    // 뺀 구간을 이번 회차가 읽는다 — 하한을 24시간에 두면 그 구간이 어느 회차에서도 안 읽힌다.
    const receiptDeadlineMs = CUJ_THRESHOLDS.longMentionDeadlineMs;
    await this.checkSafely(5, violations, async () =>
      detectMentionViolations(
        await this.reader.readMentions(since, now),
        await this.reader.readMentionReceipts(
          new Date(since.getTime() - receiptDeadlineMs),
          new Date(now.getTime() - receiptDeadlineMs),
        ),
      ),
    );
    await this.checkSafely(6, violations, async () =>
      detectApprovalViolations(
        await this.reader.readFailedPreviews(since, now),
      ),
    );

    if (violations.length === 0) {
      return { skip: true, emptyReason: '여섯 CUJ 모두 정상' };
    }
    const dateLabel = firedAtKst.slice(5);
    const timeLabel = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    const lines = violations.map(
      ({ title, detail }) => `• ${title} — ${escapeSlackMrkdwn(detail)}`,
    );
    return {
      skip: false,
      summaryText: [
        `*CUJ 점검 — ${dateLabel} ${timeLabel}*`,
        `깨진 여정 ${violations.length}건`,
        ...lines,
      ].join('\n'),
    };
  }

  private async checkSafely(
    cuj: CujViolation['cuj'],
    violations: CujViolation[],
    check: () => Promise<CujViolation[]>,
  ): Promise<void> {
    try {
      violations.push(...(await check()));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${CUJ_TITLES[cuj - 1]} 확인 불가: ${message}`);
      violations.push({
        cuj,
        title: CUJ_TITLES[cuj - 1],
        detail: `확인 불가 — ${message}`,
      });
    }
  }
}
