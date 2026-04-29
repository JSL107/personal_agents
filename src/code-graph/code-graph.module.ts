import { Module } from '@nestjs/common';

// V3 SOTA Foundation 1.1 — Tree-sitter 기반 Code Graph (Plan: 2026-04-29-tree-sitter-code-graph-poc.md).
// 단계 0: 빈 스캐폴드. 의존성 (tree-sitter / tree-sitter-typescript) 설치 + 모듈 등록만.
// 단계 1 부터 chunker / relation extractor / 인메모리 그래프 / query usecase 가 채워진다.
@Module({
  imports: [],
  providers: [],
  exports: [],
})
export class CodeGraphModule {}
