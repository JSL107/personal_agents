import { holidayCalendarOf } from '../../../holiday/domain/business-calendar';
import { HolidayCalendarPort } from '../../../holiday/domain/port/holiday-calendar.port';
import { CujLedgerReaderPort } from '../../domain/port/cuj-ledger.reader.port';
import { CujCheckAutopilotTask } from './cuj-check.autopilot-task';

const context = { firedAtKst: '2026-10-14', ownerSlackUserId: 'U1' };
const sent = (kind: string, createdAt: string) => ({
  status: 'SENT',
  itemKinds: [kind],
  createdAt: new Date(createdAt),
  suppressReason: null,
  errorMessage: null,
});
const run = (strategy: string) => ({
  status: 'SUCCEEDED',
  agentType: 'PAPER_RECOMMEND',
  durationMs: null,
  startedAt: new Date('2026-10-13T10:00:00Z'),
  output: { strategy },
});

describe('CujCheckAutopilotTask', () => {
  let reader: jest.Mocked<CujLedgerReaderPort>;
  let holidays: jest.Mocked<HolidayCalendarPort>;
  let task: CujCheckAutopilotTask;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-14T00:10:00Z'));
    reader = {
      findLatestCujCheckDeliveryBefore: jest.fn().mockResolvedValue(null),
      readPrReviews: jest.fn().mockResolvedValue([]),
      countUnpostedFindings: jest.fn().mockResolvedValue(0),
      readDeliveries: jest
        .fn()
        .mockImplementation(async (since: Date) =>
          since.toISOString() === '2026-10-13T15:00:00.000Z'
            ? [sent('morning-briefing', '2026-10-14T00:00:00Z')]
            : [
                sent('work-reviewer', '2026-10-13T12:00:00Z'),
                sent('daily-eval', '2026-10-13T12:00:00Z'),
                sent('evening-retro-publish', '2026-10-13T12:00:00Z'),
              ],
        ),
      readPaperRecommendations: jest
        .fn()
        .mockResolvedValue([run('LONG_TERM'), run('SWING')]),
      readPendingOrders: jest.fn().mockResolvedValue([]),
      readMentions: jest.fn().mockResolvedValue([]),
      readMentionReceipts: jest.fn().mockResolvedValue([]),
      readFailedPreviews: jest.fn().mockResolvedValue([]),
    };
    holidays = { load: jest.fn().mockResolvedValue(holidayCalendarOf([])) };
    task = new CujCheckAutopilotTask(reader, holidays);
  });

  afterEach(() => jest.useRealTimers());

  it('멘션 수신 기록은 최근 20분을 빼고, 직전 회차가 뺀 20분부터 읽는다', async () => {
    reader.readMentionReceipts.mockResolvedValue([
      { status: 'RECEIVED', finalReplyStatus: null },
    ]);
    const result = await task.run(context);
    expect(reader.readMentionReceipts).toHaveBeenCalledWith(
      new Date('2026-10-12T23:50:00Z'),
      new Date('2026-10-13T23:50:00Z'),
    );
    expect(JSON.stringify(result)).toContain('답 안 나감 1건');
  });

  it('정상 회차도 EMPTY 원장 사유를 남긴다', async () => {
    expect(await task.run(context)).toEqual({
      skip: true,
      emptyReason: '여섯 CUJ 모두 정상',
    });
  });

  it('위반된 여정만 Slack 문구에 넣는다', async () => {
    reader.readPrReviews.mockResolvedValue([
      run('LONG_TERM'),
      ...Array(3).fill({ ...run('SWING'), status: 'FAILED' }),
    ]);
    const result = await task.run(context);
    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('깨진 여정 1건');
    expect(result.summaryText).toContain('PR 리뷰 — 실패 3건 / 전체 4건');
    expect(result.summaryText).not.toContain('승인 반영');
  });

  // 늦게 돈 회차나 재실행도 판정 날짜의 원장을 읽어야 한다 — 지금 시각으로 창을 잡으면
  // 다른 날 기록과 비교해 거짓 경보가 난다.
  it('날짜 창은 지금 시각이 아니라 회차 날짜에서 잡는다', async () => {
    jest.setSystemTime(new Date('2026-10-15T03:00:00Z'));
    await task.run(context);
    const windows = reader.readDeliveries.mock.calls.map(([since, until]) => [
      since.toISOString(),
      until.toISOString(),
    ]);
    expect(windows).toEqual([
      ['2026-10-13T15:00:00.000Z', '2026-10-14T15:00:00.000Z'],
      ['2026-10-12T15:00:00.000Z', '2026-10-13T15:00:00.000Z'],
    ]);
    expect(reader.readPaperRecommendations).toHaveBeenCalledWith(
      new Date('2026-10-12T15:00:00.000Z'),
      new Date('2026-10-13T15:00:00.000Z'),
    );
  });

  it('게시 미완 지적은 최근 10분을 빼고 센다', async () => {
    await task.run(context);
    expect(reader.countUnpostedFindings).toHaveBeenCalledWith(
      new Date('2026-10-13T00:10:00.000Z'),
      new Date('2026-10-14T00:00:00.000Z'),
    );
  });

  it('한 조회 실패를 확인 불가로 알리고 다른 CUJ 판정도 계속한다', async () => {
    reader.readPrReviews.mockRejectedValue(new Error('reader <down>'));
    reader.readFailedPreviews.mockResolvedValue([{ kind: 'PUBLISH' }]);
    const result = await task.run(context);
    expect(result.summaryText).toContain('PR 리뷰 — 확인 불가');
    expect(result.summaryText).toContain('reader &lt;down&gt;');
    expect(result.summaryText).toContain('승인 반영 — 반영 실패 1건');
  });
});
