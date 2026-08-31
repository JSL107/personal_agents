export type DiagramViolationRule =
  | 'FONT_TOO_SMALL'
  | 'TEXT_COVERED'
  | 'OVERFLOW_X'
  | 'TOO_TALL';

export interface DiagramTextMeasurement {
  // 사람이 로그에서 어느 요소인지 알아볼 수 있는 표식. 재작업 프롬프트에도 그대로 실린다.
  label: string;
  // CSS font-size 가 아니라 실제 렌더 높이 기반 값. SVG viewBox 스케일이 반영된 크기다.
  renderedFontPx: number;
  // 글자 자리에서 실제로 보이는 최상단 요소가 이 글자 자신이 아니면 true.
  // 크기·폭과 무관하게, 다른 도형·글자에 덮여 사람 눈에 안 보이는 경우를 잡는다.
  covered: boolean;
}

export interface DiagramMeasurements {
  texts: DiagramTextMeasurement[];
  contentWidth: number;
  contentHeight: number;
}

export interface DiagramLimits {
  widthPx: number;
  minFontPx: number;
  maxHeightPx: number;
}

export interface DiagramViolation {
  rule: DiagramViolationRule;
  detail: string;
}

export const findDiagramViolations = (
  measurements: DiagramMeasurements,
  limits: DiagramLimits,
): DiagramViolation[] => {
  const violations: DiagramViolation[] = [];

  const tooSmall = measurements.texts.filter(
    (text) => text.renderedFontPx < limits.minFontPx,
  );
  if (measurements.texts.length === 0) {
    violations.push({
      rule: 'FONT_TOO_SMALL',
      detail: '글자를 하나도 찾지 못했습니다. 빈 그림일 가능성이 높습니다.',
    });
  } else if (tooSmall.length > 0) {
    const listed = tooSmall
      .map((text) => `${text.label}(${Math.round(text.renderedFontPx)}px)`)
      .join(', ');
    violations.push({
      rule: 'FONT_TOO_SMALL',
      detail: `글자 하한 ${limits.minFontPx}px 미만: ${listed}`,
    });
  }

  const covered = measurements.texts.filter((text) => text.covered);
  if (covered.length > 0) {
    const listed = covered.map((text) => text.label).join(', ');
    violations.push({
      rule: 'TEXT_COVERED',
      detail: `다른 요소에 가려져 안 보이는 글자: ${listed}`,
    });
  }

  if (measurements.contentWidth > limits.widthPx) {
    violations.push({
      rule: 'OVERFLOW_X',
      detail: `내용 폭 ${Math.round(measurements.contentWidth)}px 가 캔버스 ${limits.widthPx}px 를 넘었습니다.`,
    });
  }

  if (measurements.contentHeight > limits.maxHeightPx) {
    violations.push({
      rule: 'TOO_TALL',
      detail: `내용 높이 ${Math.round(measurements.contentHeight)}px 가 상한 ${limits.maxHeightPx}px 를 넘었습니다.`,
    });
  }

  return violations;
};
