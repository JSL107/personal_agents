import { CodeChunk } from '../code-chunk.type';

// 단계 1 — Code Graph 의 chunker Port. tree-sitter / babel / typescript-compiler-api 등 어떤 파서로도
// 구현 가능하도록 thin interface 만 노출. 단계 2 의 RelationExtractor 와 분리해 책임 명확화.
export const CODE_PARSER_PORT = Symbol('CODE_PARSER_PORT');

export interface CodeParserPort {
  parseFile(input: { filePath: string; source: string }): CodeChunk[];
}
