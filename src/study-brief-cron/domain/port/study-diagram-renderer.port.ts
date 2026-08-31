import { DiagramLimits, DiagramViolation } from '../study-diagram.checker';

export const STUDY_DIAGRAM_RENDERER_PORT = Symbol(
  'STUDY_DIAGRAM_RENDERER_PORT',
);

export interface RenderDiagramInput {
  html: string;
  limits: DiagramLimits;
}

export interface RenderedDiagram {
  png: Buffer;
  // 비어 있어야 쓸 수 있는 그림이다. 위반이 있어도 png 는 함께 온다 — 수동 확인 때 눈으로 보려면 필요하다.
  violations: DiagramViolation[];
}

export interface StudyDiagramRendererPort {
  render(input: RenderDiagramInput): Promise<RenderedDiagram>;
}
