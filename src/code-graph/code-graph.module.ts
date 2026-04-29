import { Module } from '@nestjs/common';

import { BuildCodeGraphUsecase } from './application/build-code-graph.usecase';
import { CODE_PARSER_PORT } from './domain/port/code-parser.port';
import { CODE_RELATION_EXTRACTOR_PORT } from './domain/port/code-relation-extractor.port';
import { CodeGraphSnapshotStore } from './infrastructure/code-graph.snapshot-store';
import { TreeSitterParser } from './infrastructure/tree-sitter-parser';
import { TreeSitterRelationExtractor } from './infrastructure/tree-sitter-relation-extractor';

// V3 SOTA Foundation 1.1 — Tree-sitter 기반 Code Graph (Plan: 2026-04-29-tree-sitter-code-graph-poc.md).
// 단계 1: chunker (CodeParserPort + TreeSitterParser).
// 단계 2: relation indexer (CodeRelationExtractorPort + TreeSitterRelationExtractor).
// 단계 3: BuildCodeGraphUsecase + CodeGraphSnapshotStore (인메모리 그래프 + JSON 직렬화).
// 단계 4~5 에서 query usecase / BE-3 통합이 추가된다.
@Module({
  imports: [],
  providers: [
    {
      provide: CODE_PARSER_PORT,
      useClass: TreeSitterParser,
    },
    {
      provide: CODE_RELATION_EXTRACTOR_PORT,
      useClass: TreeSitterRelationExtractor,
    },
    BuildCodeGraphUsecase,
    CodeGraphSnapshotStore,
  ],
  exports: [
    CODE_PARSER_PORT,
    CODE_RELATION_EXTRACTOR_PORT,
    BuildCodeGraphUsecase,
    CodeGraphSnapshotStore,
  ],
})
export class CodeGraphModule {}
