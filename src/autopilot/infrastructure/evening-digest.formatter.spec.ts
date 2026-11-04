import {
  EveningDigestInput,
  formatEveningDigest,
} from './evening-digest.formatter';

const base = (
  overrides: Partial<EveningDigestInput> = {},
): EveningDigestInput => ({
  firedAtKst: '2026-11-04',
  mergedPrCount: 4,
  keep: null,
  problem: null,
  tryNext: null,
  retroFailure: null,
  invest: null,
  carriedApprovalCount: 0,
  incidents: [],
  ...overrides,
});

describe('formatEveningDigest', () => {
  it('한 일과 회고를 순서대로 낸다', () => {
    expect(
      formatEveningDigest(
        base({
          keep: '원인을 오전에 찾아 같은 날 고쳤다.',
          problem: '리뷰 요청이 늦어 답이 내일로 밀렸다.',
          tryNext: '리뷰 요청은 오전에 먼저 보낸다.',
        }),
      ),
    ).toBe(
      [
        '🌙 *11/4(수) 마감*',
        '',
        '*한 일*',
        '• PR 4건 머지',
        '',
        '*아쉬운 점*',
        '• 리뷰 요청이 늦어 답이 내일로 밀렸다.',
        '',
        '*잘한 점*',
        '• 원인을 오전에 찾아 같은 날 고쳤다.',
        '',
        '*내일 추천*',
        '• 리뷰 요청은 오전에 먼저 보낸다.',
      ].join('\n'),
    );
  });
  it('조회와 회고 실패를 알린다', () => {
    const text = formatEveningDigest(
      base({ mergedPrCount: null, retroFailure: '시간 초과' }),
    );
    expect(text).toContain('확인하지 못했어요');
    expect(text).toContain(
      '_회고를 만들지 못했어요 (시간 초과). 내일 다시 시도해요._',
    );
  });
  it('투자와 승인 대기는 그 밖에 둔다', () => {
    const text = formatEveningDigest(
      base({
        carriedApprovalCount: 1,
        invest: {
          returns: [{ accountName: 'LONG_TERM', returnRate: '1.2' }],
          filled: { buyCount: 0, sellCount: 0 },
          next: null,
        },
      }),
    );
    expect(text).toContain('*그 밖에*\n• 장기투자 수익률 +1.2%');
    expect(text).toContain('• 승인 대기 1장');
  });
});
