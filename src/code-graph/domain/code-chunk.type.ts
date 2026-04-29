// V3 SOTA Foundation 1.1 — Tree-sitter Code Graph (단계 1: Chunker).
// .ts 파일을 함수/클래스/메서드/인터페이스/타입별로 chunk 한 결과 단위.
// 단계 2 의 RelationExtractor 가 이 chunk 들을 입력으로 받아 import/extends/calls 관계를 추출한다.

export type CodeChunkKind =
  | 'class'
  | 'function'
  | 'method'
  | 'interface'
  | 'type-alias';

export interface CodeChunk {
  filePath: string;
  kind: CodeChunkKind;
  name: string;
  // 1-indexed (사용자에게 노출 시 자연스러움). tree-sitter 는 0-indexed 라 +1.
  startLine: number;
  endLine: number;
  // chunk 의 원문 — 단계 2 RelationExtractor / LLM prompt 컨텍스트 주입에 사용.
  source: string;
}
