import { KOREAN_STYLE_TARGETS } from './korean-style-metrics';
import {
  MINIMUM_REPEAT_COUNT,
  renderBreathFeedback,
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

describe('renderBreathFeedback', () => {
  // 프롬프트에 "기본은 40~60자" 를 넣고 돌린 발행본이 32.6자였다. 모델은 자기 글의 평균을
  // 재지 못한다 — 재는 쪽은 코드이고, 그 수치를 돌려보내야 고칠 기회가 생긴다.
  it('하한 미달이면 실측 수치를 적어 되먹인다', () => {
    const block = renderBreathFeedback(32.6);
    expect(block).toContain('32.6자');
    expect(block).toContain(`${KOREAN_STYLE_TARGETS.averageLengthMin}자`);
    expect(block).toContain('한 문장으로 합쳐라');
  });

  it('하한을 넘겼으면 아무것도 붙이지 않는다', () => {
    expect(renderBreathFeedback(KOREAN_STYLE_TARGETS.averageLengthMin)).toBe(
      '',
    );
    expect(renderBreathFeedback(44.7)).toBe('');
  });

  it('실측이 없으면 아무것도 붙이지 않는다', () => {
    expect(renderBreathFeedback(undefined)).toBe('');
  });

  // 숫자를 목표로 주면 모델은 그 숫자만 맞춘다 — 앞쪽 몇 개를 합쳐 평균을 채우고 뒤에는 토막
  // 문장을 남기면, 긴 문장 뒤에 조각이 붙어 고치기 전보다 어색해진다. 숫자는 눈금이지 목표가 아니다.
  it('숫자가 아니라 리듬을 고치라고 못 박는다', () => {
    const block = renderBreathFeedback(32.6);
    expect(block).toContain('고치는 것은 숫자가 아니라 리듬이다');
    expect(block).toContain('문단은 통째로 읽고 고쳐라');
    expect(block).toContain('합칠 자리가 없으면 합치지 마라');
  });

  // 합치라고 시키면서 내용을 줄이게 두면 사실이 빠진다. 절대 규칙과 같은 방향을 못 박는다.
  it('내용 보존을 함께 요구한다', () => {
    const block = renderBreathFeedback(30);
    expect(block).toContain('사실·수치·고유명사·인용은 그대로다');
    expect(block).toContain('낱말을 새로 지어내지 마라');
  });
});
