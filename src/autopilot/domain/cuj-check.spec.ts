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
    expect(detectPrReviewViolations([run('FAILED'), run('FAILED')], 0)).toEqual(
      [],
    );
    expect(
      detectPrReviewViolations(
        [run('FAILED'), run('FAILED'), run('FAILED')],
        0,
      )[0].detail,
    ).toBe('실패 3건 / 전체 3건');
  });

  // 리뷰 실행은 게시 전에 SUCCEEDED 로 닫힌다 — 게시 실패는 실행 상태로는 안 보여 따로 센다.
  it('PR 리뷰는 실행이 모두 성공해도 게시 안 된 지적이 1건이면 경보한다', () => {
    expect(detectPrReviewViolations([run('SUCCEEDED')], 1)[0].detail).toBe(
      '게시 안 된 지적 1건',
    );
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

  describe('모의투자 회차 내용 판정', () => {
    const calendar = holidayCalendarOf([]);
    const paper = (
      strategy: string,
      output: Record<string, unknown>,
      startedAt = '2026-10-13T10:30:00Z',
    ): CujRunRow => ({
      status: 'SUCCEEDED',
      agentType: 'PAPER_RECOMMEND',
      durationMs: null,
      output: { strategy, ...output },
      startedAt: new Date(startedAt),
    });
    const held = {
      ordersCreated: 0,
      dataAsOf: '2026-10-13',
      emptyReason: { code: 'MODEL_HELD', detail: '관망' },
    };
    const swingOk = paper('SWING', {
      ordersCreated: 1,
      dataAsOf: '2026-10-13',
    });
    const detailOf = (longTerm: CujRunRow, orders = 0): string | undefined =>
      detectPaperInvestmentViolations(
        [longTerm, swingOk],
        Array.from({ length: orders }, () => ({ targetTradeDate: null })),
        '2026-10-13',
        calendar,
      )[0]?.detail;

    it('모델이 관망한 0건은 holdReason 이 비어도 정상이다', () => {
      expect(detailOf(paper('LONG_TERM', held))).toBeUndefined();
      expect(
        detailOf(
          paper('LONG_TERM', {
            ...held,
            emptyReason: { code: 'MODEL_HELD', detail: null },
          }),
        ),
      ).toBeUndefined();
    });

    it('시세가 없거나 어제 날짜가 아니면 주문이 있어도 경보한다', () => {
      expect(
        detailOf(
          paper('LONG_TERM', {
            ordersCreated: 0,
            dataAsOf: null,
            emptyReason: { code: 'NO_MARKET_DATA', detail: null },
          }),
        ),
      ).toBe('장기투자 시세 없음');
      expect(
        detailOf(
          paper('LONG_TERM', { ordersCreated: 2, dataAsOf: '2026-10-12' }),
        ),
      ).toBe('장기투자 시세가 2026-10-12 기준에 멈춤');
    });

    it('후보도 보유도 없는 0건은 경보한다', () => {
      expect(
        detailOf(
          paper('LONG_TERM', {
            ...held,
            emptyReason: { code: 'NO_CANDIDATES', detail: null },
          }),
        ),
      ).toBe('장기투자 후보도 보유 종목도 없어 주문 0건 (원인 미상)');
    });

    it('대기 주문 중복만으로 전량 제외된 0건은 정상이고 미종결 주문 경보는 남는다', () => {
      const pendingOnly = paper('LONG_TERM', {
        ...held,
        emptyReason: { code: 'ALL_FILTERED', detail: null },
        skipped: [
          { side: 'BUY', code: '017890', reason: 'PENDING_ORDER_EXISTS' },
        ],
      });
      expect(detailOf(pendingOnly)).toBeUndefined();
      expect(detailOf(pendingOnly, 1)).toBe('미종결 주문 1건');
    });

    it('대기 주문 외 사유가 섞인 전량 제외는 사유를 풀어 경보한다', () => {
      expect(
        detailOf(
          paper('LONG_TERM', {
            ...held,
            emptyReason: { code: 'ALL_FILTERED', detail: null },
            skipped: [
              { side: 'BUY', code: '1', reason: 'PENDING_ORDER_EXISTS' },
              { side: 'BUY', code: '2', reason: 'INSUFFICIENT_CASH' },
              { side: 'BUY', code: '3', reason: 'INSUFFICIENT_CASH' },
              { side: 'SELL', code: '4', reason: 'NOT_HELD' },
            ],
          }),
        ),
      ).toBe(
        '장기투자 제안이 모두 제약에 걸려 주문 0건 (현금 부족, 보유하지 않은 종목 매도)',
      );
    });

    it('전량 제외인데 제외 기록이 비면 기록 불일치로 경보한다', () => {
      expect(
        detailOf(
          paper('LONG_TERM', {
            ...held,
            emptyReason: { code: 'ALL_FILTERED', detail: null },
            skipped: [],
          }),
        ),
      ).toBe('장기투자 제안이 모두 걸렸다는데 걸린 기록이 없음');
    });

    it('사유 코드가 없거나 모르는 값이면 판정하지 않는다', () => {
      expect(
        detailOf(
          paper('LONG_TERM', { ordersCreated: 0, dataAsOf: '2026-10-13' }),
        ),
      ).toBeUndefined();
      expect(
        detailOf(
          paper('LONG_TERM', {
            ...held,
            emptyReason: { code: 'SOMETHING_NEW', detail: null },
          }),
        ),
      ).toBeUndefined();
    });

    it('휴장일 회차는 낡은 시세·0건이어도 경보하지 않는다', () => {
      const stale = paper('SWING', {
        ordersCreated: 0,
        dataAsOf: '2026-09-23',
        emptyReason: { code: 'ALL_FILTERED', detail: null },
        skipped: [{ side: 'BUY', code: '1', reason: 'INSUFFICIENT_CASH' }],
      });
      expect(
        detectPaperInvestmentViolations(
          [stale],
          [],
          '2026-09-25',
          holidayCalendarOf(['2026-09-25']),
        ),
      ).toEqual([]);
    });

    it('같은 전략에 성공이 여럿이면 마지막 회차만 판정한다', () => {
      const broken = { ...held, dataAsOf: null };
      const earlierBroken = paper('LONG_TERM', broken, '2026-10-13T10:30:00Z');
      const laterHeld = paper('LONG_TERM', held, '2026-10-13T11:00:00Z');
      expect(
        detectPaperInvestmentViolations(
          [laterHeld, earlierBroken, swingOk],
          [],
          '2026-10-13',
          calendar,
        ),
      ).toEqual([]);
      expect(
        detectPaperInvestmentViolations(
          [
            paper('LONG_TERM', held, '2026-10-13T10:30:00Z'),
            paper('LONG_TERM', broken, '2026-10-13T11:00:00Z'),
            swingOk,
          ],
          [],
          '2026-10-13',
          calendar,
        )[0].detail,
      ).toBe('장기투자 시세 없음');
    });

    it('두 전략의 문제와 미종결 주문을 한 줄로 합친다', () => {
      expect(
        detectPaperInvestmentViolations(
          [
            paper('LONG_TERM', { ...held, dataAsOf: null }),
            paper('SWING', {
              ...held,
              emptyReason: { code: 'NO_CANDIDATES', detail: null },
            }),
          ],
          [{ targetTradeDate: null }],
          '2026-10-13',
          calendar,
        ),
      ).toEqual([
        {
          cuj: 4,
          title: '모의투자',
          detail:
            '장기투자 시세 없음 · 스윙 후보도 보유 종목도 없어 주문 0건 (원인 미상) · 미종결 주문 1건',
        },
      ]);
    });
  });

  it('멘션은 일반 60초와 장시간 600초의 초과만 지연으로 센다', () => {
    expect(
      detectMentionViolations(
        [run('SUCCEEDED', 'PM', 60_000), run('SUCCEEDED', 'BLOG', 600_000)],
        [
          { status: 'REPLIED', finalReplyStatus: null },
          { status: 'REPLIED', finalReplyStatus: 'POSTED' },
        ],
      ),
    ).toEqual([]);
    expect(
      detectMentionViolations(
        [
          run('FAILED'),
          run('SUCCEEDED', 'PM', 60_001),
          run('SUCCEEDED', 'BLOG', 600_001),
        ],
        [],
      )[0].detail,
    ).toBe('실패 1건 · 지연 2건');
  });

  it('멘션 수신 기록에서 답 안 나간 건과 오류 답변을 따로 센다', () => {
    expect(
      detectMentionViolations(
        [],
        [
          { status: 'RECEIVED', finalReplyStatus: null },
          { status: 'REPLY_FAILED', finalReplyStatus: null },
          { status: 'ERROR_REPLIED', finalReplyStatus: null },
          { status: 'REPLIED', finalReplyStatus: null },
          // ack 만 나가고 결과 답장이 안 나간 블로그 멘션
          { status: 'REPLIED', finalReplyStatus: 'PENDING' },
          { status: 'REPLIED', finalReplyStatus: 'FAILED' },
          // ack 게시는 실패했지만 결과 답장은 나간 멘션 — 답을 받았다
          { status: 'REPLY_FAILED', finalReplyStatus: 'POSTED' },
        ],
      )[0].detail,
    ).toBe('답 안 나감 4건 · 오류 답변 1건');
  });

  it('승인 반영은 남은 실패가 없으면 정상이고 kind를 요약한다', () => {
    expect(detectApprovalViolations([])).toEqual([]);
    expect(detectApprovalViolations([{ kind: 'PUBLISH' }])[0].detail).toBe(
      '반영 실패 1건 (kind PUBLISH)',
    );
  });
});
