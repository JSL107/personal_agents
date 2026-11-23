import { Module } from '@nestjs/common';

import { BuildCodeGraphUsecase } from './application/build-code-graph.usecase';
import { CodeGraphQueryUsecase } from './application/code-graph-query.usecase';
import { CODE_PARSER_PORT } from './domain/port/code-parser.port';
import { TreeSitterParser } from './infrastructure/tree-sitter-parser';

// V3 SOTA Foundation 1.1 — Tree-sitter 기반 Code Graph (Plan: 2026-04-29-tree-sitter-code-graph-poc.md).
// chunker (CodeParserPort + TreeSitterParser) → BuildCodeGraphUsecase → CodeGraphQueryUsecase 키워드 검색.
// 관계 추출·스냅샷 저장·관계 질의 4종은 사용처가 없어 2026-11-20 걷어냈다(git 이력에 남아 있다).
@Module({
  imports: [],
  providers: [
    {
      provide: CODE_PARSER_PORT,
      useClass: TreeSitterParser,
    },
    BuildCodeGraphUsecase,
    CodeGraphQueryUsecase,
  ],
  exports: [CODE_PARSER_PORT, BuildCodeGraphUsecase, CodeGraphQueryUsecase],
})
export class CodeGraphModule {}
