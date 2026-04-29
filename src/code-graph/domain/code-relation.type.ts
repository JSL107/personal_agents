// V3 SOTA Foundation 1.1 — Tree-sitter Code Graph (단계 2: Relation Indexer).
// chunk 간 / chunk-외부 관계를 4종으로 표현. 단계 4 query usecase 가 이 relation 들을 traversal 해
// "Port X 를 구현한 Adapter" / "함수 Y 를 호출하는 곳" 같은 multi-hop 추론을 처리한다.
//
// 의미 매핑:
// - imports: from = 파일 경로, to = import path (예: './foo' / '@nestjs/common'), symbols = named import 식별자들
// - extends: from = 자식 class/interface 이름, to = 부모 class/interface 이름
// - implements: from = class 이름, to = 인터페이스/Port 이름 (이대리 Port-Adapter 컨벤션 포함)
// - calls: from = 파일 경로, to = 호출 식별자 텍스트 (`foo` / `obj.bar`), callSite = 줄 번호 (1-indexed)
export type CodeRelation =
  | { kind: 'imports'; from: string; to: string; symbols: string[] }
  | { kind: 'extends'; from: string; to: string }
  | { kind: 'implements'; from: string; to: string }
  | { kind: 'calls'; from: string; to: string; callSite: { line: number } };
