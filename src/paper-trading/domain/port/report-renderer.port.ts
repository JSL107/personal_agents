export const REPORT_RENDERER_PORT = Symbol('REPORT_RENDERER_PORT');

export interface RenderReportInput {
  html: string;
  // 논리 폭(px). HTML 이 이 폭에 맞춰 레이아웃되고, 물리 픽셀은 어댑터가 배율을 올려 뜬다.
  widthPx: number;
}

// `study-brief-cron` 의 `StudyDiagramRendererPort` 와 나누어 둔다. 그쪽 계약은 글자 크기·
// 가려짐 판정(`DiagramLimits` / `DiagramViolation`)을 함께 나르는데, 그것은 LLM 이 만든
// 문서를 검사하기 위한 것이다. 이 리포트의 HTML 은 우리 코드가 만들므로 검사할 대상이
// 없고, 그 계약을 끌어오면 쓰지 않는 한계값을 매번 지어내 넘겨야 한다.
export interface ReportRendererPort {
  render(input: RenderReportInput): Promise<Buffer>;
}
