import {
  buildStudyDiagramPrompt,
  buildStudyDiagramRetryPrompt,
} from './study-diagram.prompt';

const input = {
  topic: 'durable execution',
  kind: 'CONCEPT' as const,
  reportMd: '워크플로가 중단돼도 이어서 실행하는 방식이다.',
  limits: { widthPx: 700, minFontPx: 14, maxHeightPx: 1600 },
};

describe('buildStudyDiagramPrompt', () => {
  it('주제와 본문을 프롬프트에 싣는다', () => {
    const prompt = buildStudyDiagramPrompt(input);

    expect(prompt).toContain('durable execution');
    expect(prompt).toContain('워크플로가 중단돼도');
  });

  it('수치를 변수 이름이 아니라 실제 값으로 박는다', () => {
    const prompt = buildStudyDiagramPrompt(input);

    expect(prompt).toContain('700');
    expect(prompt).toContain('14');
    expect(prompt).toContain('1600');
    expect(prompt).not.toContain('STUDY_DIAGRAM_WIDTH_PX');
    expect(prompt).not.toContain('MIN_FONT');
  });

  it('외부 리소스 금지와 인라인 조건을 명시한다', () => {
    const prompt = buildStudyDiagramPrompt(input);

    expect(prompt).toContain('인라인');
    expect(prompt).toMatch(/CDN|외부/);
  });

  it('SVG 의 width·height 를 viewBox 와 맞추라고 지시한다', () => {
    const prompt = buildStudyDiagramPrompt(input);

    expect(prompt).toContain('viewBox');
  });

  it('출력 형식을 html 코드펜스 하나로 고정한다', () => {
    const prompt = buildStudyDiagramPrompt(input);

    expect(prompt).toContain('```html');
  });

  it('공개 발행 대비 익명화 조건을 넣는다', () => {
    const prompt = buildStudyDiagramPrompt(input);

    expect(prompt).toMatch(/회사명|사내/);
  });
});

describe('buildStudyDiagramRetryPrompt', () => {
  const violations = [
    {
      rule: 'FONT_TOO_SMALL' as const,
      detail: '글자 하한 14px 미만: svg>text(9px)',
    },
  ];

  it('무엇이 왜 걸렸는지를 그대로 싣는다', () => {
    const prompt = buildStudyDiagramRetryPrompt({ ...input, violations });

    expect(prompt).toContain('svg>text(9px)');
  });

  it('원래 프롬프트의 주제와 본문은 그대로 유지한다', () => {
    const prompt = buildStudyDiagramRetryPrompt({ ...input, violations });

    expect(prompt).toContain('durable execution');
    expect(prompt).toContain('워크플로가 중단돼도');
  });

  it('직전 시도가 거부됐다는 사실을 알린다', () => {
    const prompt = buildStudyDiagramRetryPrompt({ ...input, violations });

    expect(prompt).toMatch(/거부|다시/);
  });

  it('위반이 여러 건이면 모두 싣는다', () => {
    const prompt = buildStudyDiagramRetryPrompt({
      ...input,
      violations: [
        ...violations,
        {
          rule: 'OVERFLOW_X' as const,
          detail: '내용 폭 812px 가 캔버스 700px 를 넘었습니다.',
        },
      ],
    });

    expect(prompt).toContain('812px');
    expect(prompt).toContain('9px');
  });
});
