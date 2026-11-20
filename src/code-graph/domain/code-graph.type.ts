import { CodeChunk } from './code-chunk.type';

// V3 SOTA Foundation 1.1 단계 3 — Code Graph 인메모리 단위. 판정마다 새로 빌드하고 저장하지 않는다.
export interface CodeGraphSnapshot {
  // build 기준 디렉터리. 모든 chunk.filePath 는 rootDir 상대경로.
  rootDir: string;
  builtAt: string; // ISO 8601
  chunks: CodeChunk[];
}
