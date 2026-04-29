import { CodeChunk } from './code-chunk.type';
import { CodeRelation } from './code-relation.type';

// V3 SOTA Foundation 1.1 단계 3 — Code Graph 인메모리/직렬화 단위.
// chunks + relations 를 한 단위로 묶어 snapshot 저장/로드. version 으로 forward-compat 검증.
export const CODE_GRAPH_SNAPSHOT_VERSION = 1;

export interface CodeGraphSnapshot {
  version: number;
  // build 기준 디렉터리. 모든 chunk.filePath / relation.from(file) 은 rootDir 상대경로.
  rootDir: string;
  builtAt: string; // ISO 8601
  chunks: CodeChunk[];
  relations: CodeRelation[];
}
