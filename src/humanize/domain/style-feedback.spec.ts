import {
  MINIMUM_REPEAT_COUNT,
  renderStyleFeedback,
  StyleFeedbackRun,
  toStyleFeedbackRun,
} from './style-feedback';

const run = (...gaps: string[]): StyleFeedbackRun => ({ gaps });

describe('renderStyleFeedback', () => {
  it('이력이 없으면 빈 문자열 — 프롬프트에 아무것도 더하지 않는다', () => {
    expect(renderStyleFeedback([])).toBe('');
  });

  it('갭이 없던 회차만 있으면 빈 문자열', () => {
    expect(renderStyleFeedback([run(), run(), run()])).toBe('');
  });

  it('반복된 항목만 싣는다 — 한 번은 그 글의 사정일 수 있다', () => {
    const rendered = renderStyleFeedback([
      run('종결체교대 76%(≤60%)'),
      run('종결체교대 71%(≤60%)'),
      run('최장 210자(≤180)'),
    ]);

    expect(rendered).toContain('종결체교대');
    expect(rendered).not.toContain('최장');
  });

  it('반복 횟수와 가장 최근 값을 함께 적는다', () => {
    const rendered = renderStyleFeedback([
      run('종결체교대 76%(≤60%)'),
      run('종결체교대 71%(≤60%)'),
    ]);

    expect(rendered).toContain('2/2편');
    expect(rendered).toContain('종결체교대 76%(≤60%)');
  });

  it('임계 미만 반복은 제외한다', () => {
    const runs = Array.from({ length: MINIMUM_REPEAT_COUNT - 1 }, () =>
      run('종결체교대 76%(≤60%)'),
    );

    expect(renderStyleFeedback([...runs, run(), run(), run()])).toBe('');
  });

  it('여러 항목이 반복되면 잦은 순으로 싣는다', () => {
    const rendered = renderStyleFeedback([
      run('종결체교대 76%(≤60%)', '금지접속사 3회(0회)'),
      run('종결체교대 71%(≤60%)', '금지접속사 2회(0회)'),
      run('종결체교대 83%(≤60%)'),
    ]);

    expect(rendered.indexOf('종결체교대')).toBeLessThan(
      rendered.indexOf('금지접속사'),
    );
  });

  it('첫 회차가 가장 최근이다 — 최신 값을 보여준다', () => {
    const rendered = renderStyleFeedback([
      run('종결체교대 83%(≤60%)'),
      run('종결체교대 71%(≤60%)'),
    ]);

    expect(rendered).toContain('종결체교대 83%(≤60%)');
    expect(rendered).not.toContain('71%');
  });

  it('고쳐야 할 방향을 지시로 함께 싣는다', () => {
    const rendered = renderStyleFeedback([
      run('종결체교대 76%(≤60%)'),
      run('종결체교대 71%(≤60%)'),
    ]);

    expect(rendered).toContain('이번 글에서는');
  });

  it('항목 이름에 공백이 없는 지표도 묶인다', () => {
    const rendered = renderStyleFeedback([
      run('종결체교대 55%(≤40%)'),
      run('종결체교대 61%(≤40%)'),
    ]);

    expect(rendered).toContain('2/2편');
    expect(rendered).toContain('종결체교대');
  });
});

describe('toStyleFeedbackRun', () => {
  it('갭 배열이 있으면 표본으로 받는다', () => {
    expect(toStyleFeedbackRun({ styleGaps: ['편차 12.3(≥15)'] })).toEqual({
      gaps: ['편차 12.3(≥15)'],
    });
  });

  it('빈 배열도 표본이다 — 갭이 없던 회차가 분모에서 빠지면 반복 비율이 부풀려진다', () => {
    expect(toStyleFeedbackRun({ styleGaps: [] })).toEqual({ gaps: [] });
  });

  it('필드가 없던 시절 회차는 표본에서 뺀다', () => {
    expect(toStyleFeedbackRun({ humanizedKeys: ['0', '1'] })).toBeNull();
  });

  it('형태가 어긋나면 표본에서 뺀다', () => {
    expect(toStyleFeedbackRun(null)).toBeNull();
    expect(toStyleFeedbackRun('gaps')).toBeNull();
    expect(toStyleFeedbackRun({ styleGaps: 'gap' })).toBeNull();
    expect(toStyleFeedbackRun({ styleGaps: [1, 2] })).toBeNull();
  });
});

describe('판정에서 내린 축', () => {
  it('원장에 남은 옛 갭은 되먹이지 않는다', () => {
    // 축을 내려도 이미 적재된 회차의 갭 문자열은 그대로다. 거르지 않으면 내린 기준이
    // 최근 표본에서 밀려날 때까지 계속 프롬프트로 들어간다.
    const runs = [
      { gaps: ['편차 9.6(≥11)', '짧은문장 12%(≥20%)'] },
      { gaps: ['편차 9.1(≥11)', '구어 33%(10~20%)'] },
      { gaps: ['편차 8.5(≥11)', '구어 30%(10~20%)'] },
    ];

    expect(renderStyleFeedback(runs)).toBe('');
  });

  it('판정 축은 같은 표본에서 그대로 실린다', () => {
    // 위 테스트가 "필터가 다 걸러서" 가 아니라 "내린 축만 걸러서" 비었음을 보인다.
    const runs = [
      { gaps: ['편차 9.6(≥11)', '금지접속사 2회(0회)'] },
      { gaps: ['편차 9.1(≥11)', '금지접속사 1회(0회)'] },
    ];

    const block = renderStyleFeedback(runs);
    expect(block).toContain('금지접속사');
    expect(block).not.toContain('편차');
  });
});
