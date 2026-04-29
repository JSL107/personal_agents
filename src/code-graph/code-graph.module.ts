import { Module } from '@nestjs/common';

import { CODE_PARSER_PORT } from './domain/port/code-parser.port';
import { TreeSitterParser } from './infrastructure/tree-sitter-parser';

// V3 SOTA Foundation 1.1 — Tree-sitter 기반 Code Graph (Plan: 2026-04-29-tree-sitter-code-graph-poc.md).
// 단계 1: chunker (CodeParserPort + TreeSitterParser).
// 단계 2~5 에서 relation extractor / 인메모리 그래프 / query usecase / BE-3 통합이 추가된다.
@Module({
  imports: [],
  providers: [
    {
      provide: CODE_PARSER_PORT,
      useClass: TreeSitterParser,
    },
  ],
  exports: [CODE_PARSER_PORT],
})
export class CodeGraphModule {}
