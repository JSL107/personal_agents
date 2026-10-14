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
      readPrReviews: jest.fn().mockResolvedValue([]),
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
      readFailedPreviews: jest.fn().mockResolvedValue([]),
    };
    holidays = { load: jest.fn().mockResolvedValue(holidayCalendarOf([])) };
    task = new CujCheckAutopilotTask(reader, holidays);
  });

  afterEach(() => jest.useRealTimers());

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

  it('한 조회 실패를 확인 불가로 알리고 다른 CUJ 판정도 계속한다', async () => {
    reader.readPrReviews.mockRejectedValue(new Error('reader <down>'));
    reader.readFailedPreviews.mockResolvedValue([{ kind: 'PUBLISH' }]);
    const result = await task.run(context);
    expect(result.summaryText).toContain('PR 리뷰 — 확인 불가');
    expect(result.summaryText).toContain('reader &lt;down&gt;');
    expect(result.summaryText).toContain('승인 반영 — 반영 실패 1건');
  });
});
