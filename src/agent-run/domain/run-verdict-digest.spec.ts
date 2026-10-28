import {
  formatPmPlanQuote,
  RunVerdictDigestRun,
  selectRunVerdictDigestCards,
} from './run-verdict-digest';

const run = (
  overrides: Partial<RunVerdictDigestRun> & Pick<RunVerdictDigestRun, 'id'>,
): RunVerdictDigestRun => ({
  agentType: 'EVENING_RETRO',
  // 실행마다 다른 날 — 같은 날 같은 종류는 마지막 한 건만 남는다.
  startedAt: new Date(Date.UTC(2026, 9, 10 + overrides.id, 10)),
  output: { retrospective: { problem: '근거 없이 끝냈다.' } },
  judgedFacets: [],
  ...overrides,
});

describe('selectRunVerdictDigestCards', () => {
  it('판정 안 된 축만 남기고, 축이 모두 판정된 실행은 뺀다', () => {
    const cards = selectRunVerdictDigestCards([
      run({ id: 1, judgedFacets: ['retro_problem'] }),
      run({ id: 2, judgedFacets: ['retro_problem', 'overall'] }),
    ]);

    expect(cards).toEqual([
      {
        agentType: 'EVENING_RETRO',
        heading: '🌙 저녁 회고 주간 판정',
        entries: [
          {
            agentRunId: 1,
            startedAt: expect.any(Date),
            facets: ['overall'],
            quote: '근거 없이 끝냈다.',
          },
        ],
      },
    ]);
  });

  it('아쉬운 점이 이미 판정돼 회고 전체만 남으면 아쉬운 점 대신 회고 내용을 인용한다', () => {
    const [card] = selectRunVerdictDigestCards([
      run({
        id: 1,
        judgedFacets: ['retro_problem'],
        output: {
          retrospective: {
            problem: '근거 없이 끝냈다.',
            keep: '대조로 원인을 가렸다.',
          },
        },
      }),
    ]);

    expect(card.entries[0]).toMatchObject({
      facets: ['overall'],
      quote: '대조로 원인을 가렸다.',
    });
  });

  it('같은 날 같은 종류의 실행이 여럿이면(발송 실패 뒤 재시도) 마지막 실행만 묻는다', () => {
    const [card] = selectRunVerdictDigestCards([
      run({ id: 1, startedAt: new Date('2026-10-27T10:00:00.000Z') }),
      run({ id: 2, startedAt: new Date('2026-10-27T10:20:00.000Z') }),
      // 같은 KST 날짜(10-28 00:30)지만 UTC 로는 전날 — 날짜는 KST 로 가른다.
      run({ id: 3, startedAt: new Date('2026-10-27T15:30:00.000Z') }),
    ]);

    expect(card.entries.map((entry) => entry.agentRunId)).toEqual([2, 3]);
  });

  it('매일 버튼과 같은 규칙으로 축을 정한다 — 아쉬운 점이 빈 회고는 전체 축만, 조용한 PO 는 묻지 않는다', () => {
    const cards = selectRunVerdictDigestCards([
      run({
        id: 1,
        output: { retrospective: { keep: '대조로 원인을 가렸다.' } },
      }),
      run({
        id: 2,
        agentType: 'PO_SHADOW',
        output: { quiet: true, headline: '계획대로 진행 중' },
      }),
      run({
        id: 3,
        agentType: 'PO_SHADOW',
        output: { quiet: false, headline: '#264 업로드 차단부터 본다.' },
      }),
    ]);

    expect(
      cards.map((card) => [
        card.agentType,
        card.entries.map((entry) => [
          entry.agentRunId,
          entry.facets,
          entry.quote,
        ]),
      ]),
    ).toEqual([
      ['EVENING_RETRO', [[1, ['overall'], '대조로 원인을 가렸다.']]],
      ['PO_SHADOW', [[3, ['po_first_action'], '#264 업로드 차단부터 본다.']]],
    ]);
  });

  it('카드 순서는 저녁 회고 → PO → 아침 계획, 카드 안은 실행 시각 순이다', () => {
    const cards = selectRunVerdictDigestCards([
      run({
        id: 9,
        agentType: 'PM',
        output: { topPriority: { title: 'A' } },
      }),
      run({ id: 5, startedAt: new Date('2026-10-28T10:00:00.000Z') }),
      run({ id: 4, startedAt: new Date('2026-10-26T10:00:00.000Z') }),
    ]);

    expect(cards.map((card) => card.agentType)).toEqual([
      'EVENING_RETRO',
      'PM',
    ]);
    expect(cards[0].entries.map((entry) => entry.agentRunId)).toEqual([4, 5]);
  });

  it('인용을 만들 수 없는 실행은 내지 않는다 — 일주일 뒤에 무엇을 판정하는지 알 수 없다', () => {
    const cards = selectRunVerdictDigestCards([
      run({ id: 1, output: null }),
      run({ id: 2, agentType: 'PM', output: 'x' }),
    ]);

    expect(cards).toEqual([]);
  });

  it('아쉬운 점과 유지 칸이 비면 다음 칸(다음엔·넘어감)을 인용으로 쓴다', () => {
    const [card] = selectRunVerdictDigestCards([
      run({
        id: 1,
        output: { retrospective: { carryOver: 'PR 하나가 열려 있다.' } },
      }),
    ]);

    expect(card.entries[0]).toMatchObject({
      facets: ['overall'],
      quote: 'PR 하나가 열려 있다.',
    });
  });
});

describe('formatPmPlanQuote', () => {
  it('최우선과 오전 항목 제목을 중복 없이 최대 3개 잇는다', () => {
    expect(
      formatPmPlanQuote({
        topPriority: { title: 'A' },
        morning: [
          { title: 'A' },
          { title: 'B' },
          { title: 'C' },
          { title: 'D' },
        ],
      }),
    ).toBe('A / B / C');
  });

  it('제목이 하나도 없으면 undefined', () => {
    expect(formatPmPlanQuote({ morning: [{ title: '  ' }] })).toBeUndefined();
    expect(formatPmPlanQuote(undefined)).toBeUndefined();
  });
});
