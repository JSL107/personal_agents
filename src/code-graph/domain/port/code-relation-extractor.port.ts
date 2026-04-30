import { CodeRelation } from '../code-relation.type';

// 단계 2 — chunker 와 분리된 별도 Port. tree-sitter / typescript-compiler-api / babel 등 어떤 백엔드도
// 가능. 단계 3 인메모리 그래프가 chunker + extractor 양쪽 결과를 통합 보관한다.
export const CODE_RELATION_EXTRACTOR_PORT = Symbol(
  'CODE_RELATION_EXTRACTOR_PORT',
);

export interface CodeRelationExtractorPort {
  extractRelations(input: { filePath: string; source: string }): CodeRelation[];
}
