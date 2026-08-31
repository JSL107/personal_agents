import {
  careerGroupRepo,
  readImpactContext,
  resolveCareerPrGroups,
  withImpactContext,
} from './evening-career-payload';

const GROUPED = {
  prGroups: [['o/company#1', 'o/company#2'], ['o/personal#9']],
  slackUserId: 'U1',
};

describe('resolveCareerPrGroups', () => {
  it('신형 prGroups 를 그대로 쓴다', () => {
    expect(resolveCareerPrGroups(GROUPED)).toEqual(GROUPED.prGroups);
  });

  it('구형 prRefs 카드는 한 묶음으로 본다 (승인 대기 중 카드 회귀 방지)', () => {
    expect(
      resolveCareerPrGroups({ prRefs: ['o/legacy#3'], slackUserId: 'U1' }),
    ).toEqual([['o/legacy#3']]);
  });

  it('빈 묶음·없는 payload 는 0개', () => {
    expect(resolveCareerPrGroups(null)).toEqual([]);
    expect(
      resolveCareerPrGroups({ prGroups: [[]], slackUserId: 'U1' }),
    ).toEqual([]);
  });
});

describe('careerGroupRepo', () => {
  it('묶음의 저장소 이름을 뽑는다', () => {
    expect(careerGroupRepo(['o/company#1'])).toBe('o/company');
    expect(careerGroupRepo([])).toBe('(알 수 없음)');
  });
});

describe('withImpactContext — 묶음별 맥락 갱신', () => {
  it('지정한 묶음에만 심고 원본은 건드리지 않는다', () => {
    const next = withImpactContext({
      payload: GROUPED,
      index: 1,
      impactContext: '  주간 배치 실패 12건 → 0건  ',
    });

    expect(next.impactContexts).toEqual([null, '주간 배치 실패 12건 → 0건']);
    expect(GROUPED).not.toHaveProperty('impactContexts');
  });

  it('다른 묶음에 이미 적은 맥락은 보존한다', () => {
    const first = withImpactContext({
      payload: GROUPED,
      index: 0,
      impactContext: '결제 실패율 3%→0.5%',
    });
    const second = withImpactContext({
      payload: first,
      index: 1,
      impactContext: '주간 배치 실패 12건 → 0건',
    });

    expect(second.impactContexts).toEqual([
      '결제 실패율 3%→0.5%',
      '주간 배치 실패 12건 → 0건',
    ]);
  });

  it('전부 비면 키를 지운다 — "적었다가 지웠다" 를 "안 적었다" 로 되돌린다', () => {
    const written = withImpactContext({
      payload: GROUPED,
      index: 0,
      impactContext: '오타',
    });
    const cleared = withImpactContext({
      payload: written,
      index: 0,
      impactContext: '',
    });

    expect(cleared).not.toHaveProperty('impactContexts');
    expect(cleared).toEqual(GROUPED);
  });

  it('경력 카드가 아니거나 없는 묶음이면 거부한다 (남의 payload 오염 차단)', () => {
    expect(() =>
      withImpactContext({
        payload: { pageId: 'notion-page', slackUserId: 'U1' },
        index: 0,
        impactContext: 'x',
      }),
    ).toThrow('경력 반영 카드가 아닙니다');
    expect(() =>
      withImpactContext({ payload: GROUPED, index: 5, impactContext: 'x' }),
    ).toThrow('묶음 6 번이 카드에 없습니다');
    expect(() =>
      withImpactContext({ payload: null, index: 0, impactContext: 'x' }),
    ).toThrow('객체가 아닙니다');
  });
});

describe('readImpactContext', () => {
  it('공백만 적힌 맥락은 없는 것으로 본다', () => {
    const payload = { ...GROUPED, impactContexts: ['   ', null] };
    expect(readImpactContext(payload, 0)).toBeUndefined();
    expect(readImpactContext(payload, 1)).toBeUndefined();
  });

  it('앞뒤 공백을 떼고 돌려준다', () => {
    expect(
      readImpactContext({ ...GROUPED, impactContexts: ['  값  ', null] }, 0),
    ).toBe('값');
  });
});
