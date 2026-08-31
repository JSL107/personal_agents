import { findDiagramViolations } from './study-diagram.checker';

const limits = { widthPx: 700, minFontPx: 14, maxHeightPx: 1600 };
const clean = {
  texts: [
    { label: 'svg>text "요청"', renderedFontPx: 18 },
    { label: 'div.caption', renderedFontPx: 14 },
  ],
  contentWidth: 700,
  contentHeight: 900,
};

describe('findDiagramViolations', () => {
  it('모든 기준을 만족하면 위반이 없다', () => {
    expect(findDiagramViolations(clean, limits)).toEqual([]);
  });

  it('하한과 같은 글자 크기는 통과시킨다', () => {
    const measurements = {
      ...clean,
      texts: [{ label: 'svg>text', renderedFontPx: 14 }],
    };

    expect(findDiagramViolations(measurements, limits)).toEqual([]);
  });

  it('하한 미만 글자가 하나라도 있으면 FONT_TOO_SMALL 을 낸다', () => {
    const measurements = {
      ...clean,
      texts: [
        { label: 'svg>text "정상"', renderedFontPx: 18 },
        { label: 'svg>text "작음"', renderedFontPx: 9 },
      ],
    };

    const violations = findDiagramViolations(measurements, limits);

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('FONT_TOO_SMALL');
    expect(violations[0].detail).toContain('svg>text "작음"');
    expect(violations[0].detail).toContain('9');
    expect(violations[0].detail).toContain('14');
  });

  it('작은 글자가 여러 개면 detail 에 함께 담는다', () => {
    const measurements = {
      ...clean,
      texts: [
        { label: 'a', renderedFontPx: 8 },
        { label: 'b', renderedFontPx: 10 },
      ],
    };

    const violations = findDiagramViolations(measurements, limits);

    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain('a');
    expect(violations[0].detail).toContain('b');
  });

  it('내용이 캔버스 폭을 넘으면 OVERFLOW_X 를 낸다', () => {
    const violations = findDiagramViolations(
      { ...clean, contentWidth: 812 },
      limits,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('OVERFLOW_X');
    expect(violations[0].detail).toContain('812');
    expect(violations[0].detail).toContain('700');
  });

  it('세로가 상한을 넘으면 TOO_TALL 을 낸다', () => {
    const violations = findDiagramViolations(
      { ...clean, contentHeight: 2400 },
      limits,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('TOO_TALL');
    expect(violations[0].detail).toContain('2400');
  });

  it('여러 규칙을 동시에 위반하면 모두 반환한다', () => {
    const violations = findDiagramViolations(
      {
        texts: [{ label: 'tiny', renderedFontPx: 6 }],
        contentWidth: 900,
        contentHeight: 3000,
      },
      limits,
    );

    expect(violations.map((violation) => violation.rule)).toEqual([
      'FONT_TOO_SMALL',
      'OVERFLOW_X',
      'TOO_TALL',
    ]);
  });

  it('잰 글자가 하나도 없으면 빈 그림으로 보고 FONT_TOO_SMALL 을 낸다', () => {
    const violations = findDiagramViolations(
      { ...clean, texts: [] },
      limits,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('FONT_TOO_SMALL');
  });
});
