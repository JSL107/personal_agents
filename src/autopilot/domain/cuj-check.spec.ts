import { holidayCalendarOf } from '../../holiday/domain/business-calendar';
import {
  detectApprovalViolations,
  detectEveningReviewViolations,
  detectMentionViolations,
  detectMorningBriefingViolations,
  detectPaperInvestmentViolations,
  detectPrReviewViolations,
} from './cuj-check';
import { CujDeliveryRow, CujRunRow } from './port/cuj-ledger.reader.port';

const run = (
  status: string,
  agentType = 'PM',
  durationMs: number | null = null,
  output: unknown = null,
): CujRunRow => ({
  status,
  agentType,
  durationMs,
  output,
  startedAt: new Date('2026-10-13T15:30:00Z'),
});
const delivery = (
  kind: string,
  status: string,
  createdAt: string,
  suppressReason: string | null = null,
  errorMessage: string | null = null,
): CujDeliveryRow => ({
  itemKinds: [kind],
  status,
  createdAt: new Date(createdAt),
  suppressReason,
  errorMessage,
});

describe('CUJ detectors', () => {
  it('PR 리뷰는 실패 2건까지 정상이고 3건부터 경보한다', () => {
    expect(detectPrReviewViolations([run('FAILED'), run('FAILED')])).toEqual(
      [],
    );
    expect(
      detectPrReviewViolations([run('FAILED'), run('FAILED'), run('FAILED')])[0]
        .detail,
    ).toBe('실패 3건 / 전체 3건');
  });

  it('아침 브리핑은 09:00 정각과 KST 자정 넘은 UTC 행을 올바르게 판정한다', () => {
    expect(
      detectMorningBriefingViolations(
        [delivery('morning-briefing', 'SENT', '2026-10-14T00:00:00Z')],
        '2026-10-14',
      ),
    ).toEqual([]);
    expect(
      detectMorningBriefingViolations(
        [delivery('morning-briefing', 'SENT', '2026-10-13T15:30:00Z')],
        '2026-10-14',
      ),
    ).toEqual([]);
    expect(
      detectMorningBriefingViolations(
        [delivery('morning-briefing', 'SENT', '2026-10-14T00:01:00Z')],
        '2026-10-14',
      )[0].detail,
    ).toBe('늦게 도착 09:01');
    expect(
      detectMorningBriefingViolations(
        [
          delivery(
            'morning-briefing',
            'FAILED',
            '2026-10-14T00:00:00Z',
            null,
            '전송 실패',
          ),
        ],
        '2026-10-14',
      )[0].detail,
    ).toContain('전송 실패');
  });

  it('저녁 세 항목은 콘솔 억제도 수신으로 보되 21:00 이후는 결번이다', () => {
    const rows = [
      delivery(
        'work-reviewer',
        'SUPPRESSED',
        '2026-10-13T12:00:00Z',
        'CONSOLE_ROUTE',
      ),
      delivery('daily-eval', 'SENT', '2026-10-13T12:00:00Z'),
      delivery('evening-retro-publish', 'SENT', '2026-10-13T12:00:00Z'),
    ];
    expect(detectEveningReviewViolations(rows, '2026-10-13')).toEqual([]);
    rows[2] = delivery('evening-retro-publish', 'SENT', '2026-10-13T12:01:00Z');
    expect(
      detectEveningReviewViolations(rows, '2026-10-13')[0].detail,
    ).toContain('퇴근 회고 발행');
  });

  it('모의투자는 거래일 두 전략 성공만 요구하고 주문 0건은 정상이다', () => {
    const calendar = holidayCalendarOf([]);
    const both = [
      run('SUCCEEDED', 'PAPER_RECOMMEND', null, {
        strategy: 'LONG_TERM',
        orders: [],
      }),
      run('SUCCEEDED', 'PAPER_RECOMMEND', null, {
        strategy: 'SWING',
        orders: [],
      }),
    ];
    expect(
      detectPaperInvestmentViolations(both, [], '2026-10-13', calendar),
    ).toEqual([]);
    expect(
      detectPaperInvestmentViolations(
        both.slice(0, 1),
        [{ targetTradeDate: new Date('2026-10-13') }],
        '2026-10-13',
        calendar,
      )[0].detail,
    ).toBe('스윙 추천 실행 없음 · 미종결 주문 1건');
    expect(
      detectPaperInvestmentViolations([], [], '2026-10-11', calendar),
    ).toEqual([]);
  });

  it('멘션은 일반 60초와 장시간 600초의 초과만 지연으로 센다', () => {
    expect(
      detectMentionViolations([
        run('SUCCEEDED', 'PM', 60_000),
        run('SUCCEEDED', 'BLOG', 600_000),
      ]),
    ).toEqual([]);
    expect(
      detectMentionViolations([
        run('FAILED'),
        run('SUCCEEDED', 'PM', 60_001),
        run('SUCCEEDED', 'BLOG', 600_001),
      ])[0].detail,
    ).toBe('실패 1건 · 지연 2건');
  });

  it('승인 반영은 남은 실패가 없으면 정상이고 kind를 요약한다', () => {
    expect(detectApprovalViolations([])).toEqual([]);
    expect(detectApprovalViolations([{ kind: 'PUBLISH' }])[0].detail).toBe(
      '반영 실패 1건 (kind PUBLISH)',
    );
  });
});
