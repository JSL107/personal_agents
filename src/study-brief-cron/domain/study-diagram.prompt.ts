import { DiagramLimits, DiagramViolation } from './study-diagram.checker';
import { StudyResearchKind } from './study-research.parser';

export interface BuildStudyDiagramPromptInput {
  topic: string;
  kind: StudyResearchKind;
  reportMd: string;
  limits: DiagramLimits;
}

export interface BuildStudyDiagramRetryPromptInput extends BuildStudyDiagramPromptInput {
  violations: DiagramViolation[];
}

// 오늘의 공부 노션 페이지 맨 위에 붙일 그림 한 장을 그리게 하는 프롬프트.
//
// 캔버스 가로를 노션 본문 폭과 같게 잡는 것이 이 설계의 핵심이다. 더 넓게 그리면
// 노션이 액자에 맞춰 이미지를 통째로 축소하고, 그림 안 글자도 같은 비율로 줄어
// 읽을 수 없게 된다. 세로는 축소를 유발하지 않으므로 넉넉히 쓴다.
export const buildStudyDiagramPrompt = ({
  topic,
  kind,
  reportMd,
  limits,
}: BuildStudyDiagramPromptInput): string =>
  [
    '아래 주제를 그림 한 장으로 설명하는 HTML 문서를 써라.',
    '이 그림은 그 주제를 처음 보는 사람이 글을 읽기 전에 먼저 보는 자료다.',
    '',
    `[주제] ${topic} (${kind === 'CONCEPT' ? '개념' : '도구'})`,
    '',
    '[조사 본문 — 그림의 재료]',
    reportMd,
    '',
    ...buildCanvasRules(limits),
    '',
    ...buildDrawingRules(),
    '',
    ...buildOutputRules(),
  ].join('\n');

// 재작업 프롬프트. 원래 지시를 그대로 두고 사유만 덧붙이면, 충돌하는 지시가 남아
// 무시되는 경우가 있다. 위반한 항목의 지시문 자체를 수치와 함께 다시 쓴다.
export const buildStudyDiagramRetryPrompt = ({
  topic,
  kind,
  reportMd,
  limits,
  violations,
}: BuildStudyDiagramRetryPromptInput): string =>
  [
    '직전에 그린 그림이 기준 미달로 거부됐다. 같은 주제로 다시 그려라.',
    '',
    '[거부 사유 — 이번에는 반드시 피해야 하는 것]',
    ...violations.map((violation) => `- ${violation.detail}`),
    '',
    `[주제] ${topic} (${kind === 'CONCEPT' ? '개념' : '도구'})`,
    '',
    '[조사 본문 — 그림의 재료]',
    reportMd,
    '',
    ...buildCanvasRules(limits),
    '',
    ...buildDrawingRules(),
    '- 글자 수를 줄이고 도형을 키워라. 직전 실패는 대부분 글을 많이 넣어서 생긴다.',
    '',
    ...buildOutputRules(),
  ].join('\n');

const buildCanvasRules = (limits: DiagramLimits): string[] => [
  '[캔버스 — 어기면 자동으로 거부된다]',
  `- 가로는 정확히 ${limits.widthPx}px 다. **바깥 여백까지 포함한 전체 폭**이 이 값을 넘으면 거부된다.`,
  `- html 과 body 의 margin·padding 은 0 으로 둬라. 여백이 필요하면 그림(SVG) 안에서 처리한다.`,
  `- 세로는 ${limits.maxHeightPx}px 이내면 자유롭다. 세로로 흐르는 구성으로 짜도 된다.`,
  `- 모든 글자는 화면에서 ${limits.minFontPx}px 이상으로 보여야 한다. 하나라도 작으면 거부된다.`,
  '- SVG 의 width·height 속성을 viewBox 의 크기와 같은 값으로 둬라. 축소 변환이 끼면 글자가 기준보다 작아진다.',
];

const buildDrawingRules = (): string[] => [
  '[그림]',
  '- 설명의 뼈대는 도형·화살표·크기 대비가 진다. 글은 이름표 역할만 한다.',
  '- 문장을 넣지 마라. 낱말과 짧은 구로 쓴다.',
  '- 비유를 써도 좋다. 정확한 용어보다 그림이 먼저 이해되는 쪽을 고른다.',
  '- 색은 서너 개로 제한하고, 배경은 흰색으로 둔다.',
  '- 회사명·학교명·사내 시스템 이름·업무 데이터를 쓰지 마라.',
  '- 상자·글자를 서로 겹치지 마라. 겹쳐서 가려진 글자가 하나라도 있으면 거부된다.',
];

const buildOutputRules = (): string[] => [
  '[출력 — 문자 그대로 준수]',
  '- 인라인 SVG 와 인라인 CSS 만 쓴다. CDN·외부 폰트·외부 이미지·fetch 를 쓰면 거부된다.',
  '- 설명 문장을 붙이지 말고 코드펜스 하나만 출력한다.',
  '```html',
  '<!doctype html> ... </html>',
  '```',
];
