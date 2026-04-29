# Tree-sitter Code Graph PoC (2026-04-29)

> **상위 plan**: [2026-04-29-v3-roadmap.md](./2026-04-29-v3-roadmap.md) §1.1
> **결정**: 사용자가 A (Tree-sitter PoC 부터) 선택 — V3 SOTA Foundation 1.1 의 첫 단계.
> **인프라 비용**: 0원 (인메모리 + JSON snapshot, Tree-sitter 라이브러리 free).

**Goal**: 이대리 src/ 의 모든 `.ts` 파일을 함수/클래스/Port-Adapter 단위로 chunk 한 뒤 import / extends / implements / call 관계를 인메모리 그래프로 인덱싱. BE-3 / BE-1 / BE-2 가 공통 사용할 query 인터페이스 노출.

**Architecture**: 신규 `src/code-graph/` 도메인 — DDD 4-layer (domain/application/infrastructure). 기존 패턴과 동일.

**검증**: `pnpm lint:check && pnpm test && pnpm build` 3중 green + `/codex:review` (단계별 commit 마다).

---

## 단계 0: 의존성 + 모듈 스캐폴드 (1 commit)

**Files**:
- Modify: `package.json` (web-tree-sitter 또는 tree-sitter + tree-sitter-typescript)
- Create: `src/code-graph/code-graph.module.ts`
- Modify: `src/app.module.ts` (CodeGraphModule 등록)

**Steps**:
- [ ] 의존성 옵션 비교: (a) `tree-sitter` (Node native binding, install 시 빌드) vs (b) `web-tree-sitter` (WASM, 빌드 무관). 운영 단순성 위해 **(b) WASM** 권장. 메모리 약간 더 쓰지만 macOS/Linux 일관 동작.
- [ ] `pnpm add web-tree-sitter tree-sitter-typescript` (WASM 파일은 prebuilt 동봉)
- [ ] 빈 모듈 + Module export
- [ ] 3중 green

---

## 단계 1: Tree-sitter Chunker (2 commit)

**Files**:
- Create: `src/code-graph/domain/code-chunk.type.ts` (`CodeChunk` interface)
- Create: `src/code-graph/domain/port/code-parser.port.ts` (Port)
- Create: `src/code-graph/infrastructure/tree-sitter-parser.ts` (Adapter)
- Create: `src/code-graph/infrastructure/tree-sitter-parser.spec.ts`

**CodeChunk 정의**:
```ts
interface CodeChunk {
  filePath: string;
  kind: 'class' | 'function' | 'method' | 'interface' | 'type-alias';
  name: string;
  startLine: number;
  endLine: number;
  source: string; // 원문
  // import / extends / implements / 호출 관계는 단계 2 에서 분리.
}
```

**Steps**:
- [ ] CodeChunk type + Port 정의
- [ ] Tree-sitter 로 `.ts` 한 파일 파싱 → AST 노드 walk → CodeChunk[] 변환
- [ ] spec: 작은 fixture (`fixtures/sample.ts` 5~10줄) 로 chunker 결과 검증 (Class 1, Method 2, Function 1 등)
- [ ] 3중 green + `/codex:review` → commit
- [ ] AST 정확도 추가 케이스 (제네릭, 데코레이터, async) → spec 추가 → 3중 green → commit

---

## 단계 2: Relation Indexer — Import / Extends / Implements / Call (2 commit)

**Files**:
- Create: `src/code-graph/domain/code-relation.type.ts` (`CodeRelation` interface)
- Create: `src/code-graph/domain/port/code-relation-extractor.port.ts`
- Create: `src/code-graph/infrastructure/tree-sitter-relation-extractor.ts`
- Create: `src/code-graph/infrastructure/tree-sitter-relation-extractor.spec.ts`

**CodeRelation 정의**:
```ts
type CodeRelation =
  | { kind: 'imports'; from: string; to: string; symbols: string[] }
  | { kind: 'extends'; from: string; to: string }
  | { kind: 'implements'; from: string; to: string }
  | { kind: 'calls'; from: string; to: string; callSite: { line: number } };
```

**Steps**:
- [ ] CodeRelation type + Port 정의
- [ ] AST walk 로 import 문 / `extends X` / `implements Y` / 함수 호출 추출
- [ ] spec: 위 fixture 에서 `imports A from './x'` 1건, `extends Base` 1건 등 검증
- [ ] 3중 green + `/codex:review` → commit
- [ ] Port-Adapter 패턴 특수 처리 (이대리 컨벤션: `XXX_PORT = Symbol(...)` + `@Inject(XXX_PORT)`) — symbol-based Port 식별 spec 추가
- [ ] 3중 green → commit

---

## 단계 3: 인메모리 그래프 + JSON snapshot (1 commit)

**Files**:
- Create: `src/code-graph/domain/code-graph.type.ts` (`CodeGraphSnapshot`)
- Create: `src/code-graph/application/build-code-graph.usecase.ts`
- Create: `src/code-graph/application/build-code-graph.usecase.spec.ts`
- Create: `src/code-graph/infrastructure/code-graph.snapshot-store.ts` (JSON 직렬화/복원)

**Steps**:
- [ ] CodeGraphSnapshot = `{ chunks: CodeChunk[]; relations: CodeRelation[]; rootDir: string; builtAt: Date; version: 1 }`
- [ ] BuildCodeGraphUsecase: glob `src/**/*.ts` (test 파일 / dist 제외) → chunker + extractor 호출 → snapshot
- [ ] JSON snapshot 저장 (`var/code-graph-snapshot.json`, gitignore) — 부팅 시 캐시 hit, src 파일 mtime 비교로 invalidation
- [ ] spec: 미니 src 디렉터리에 fixture 두고 build → snapshot 검증
- [ ] 3중 green + `/codex:review` → commit

---

## 단계 4: Query Usecase (2 commit)

**Files**:
- Create: `src/code-graph/application/code-graph-query.usecase.ts`
- Create: `src/code-graph/application/code-graph-query.usecase.spec.ts`

**Query 종류**:
- `findImplementersOf(portSymbol: string)` — 이 Port 를 구현하는 Adapter
- `findCallersOf(functionName: string)` — 이 함수 호출하는 곳
- `findExtendersOf(className: string)` — 이 클래스 상속한 곳
- `findFilesAffectedByImport(importPath: string)` — 이 import 변경 시 영향 파일

**Steps**:
- [ ] 4개 query 메서드 각각 구현 + spec
- [ ] 3중 green + `/codex:review` → commit
- [ ] Edge case (순환 의존, missing import) 처리 + spec
- [ ] 3중 green → commit

---

## 단계 5: BE-3 통합 (영향도 분석 lite → full) (2~3 commit)

**Files**:
- Modify: `src/agent/be-schema/application/generate-schema-proposal.usecase.ts`
- Modify: `src/agent/be-schema/domain/be-schema.type.ts` (`SchemaProposal.affectedFiles?: string[]`)
- Modify: `src/agent/be-schema/be-schema.module.ts` (CodeGraphModule import)
- Modify: `src/slack/format/be-schema.formatter.ts` (affectedFiles 노출)

**Steps**:
- [ ] schema.prisma 변경에서 model 이름 추출 → CodeGraphQueryUsecase 로 `findFilesAffectedByImport('@prisma/client')` + 모델 이름 grep
- [ ] SchemaProposal 에 affectedFiles 필드 추가 + formatter 노출 ("영향 받는 파일: 3개")
- [ ] LLM prompt 에 affectedFiles 컨텍스트 주입 → LLM 이 더 정확한 영향도 분석
- [ ] spec 갱신 (lite 5케이스 → full 8케이스)
- [ ] 3중 green + `/codex:review` → commit

---

## 검증 항목 (전체 단계 후)

- [ ] `pnpm test` 전체 green
- [ ] `pnpm build` 0 error
- [ ] `pnpm lint:check` 0 error
- [ ] `/be-schema "주문 취소 내역 테이블 추가"` 실행 시 affectedFiles 가 실제 src 파일 노출
- [ ] snapshot 파일 크기 < 5 MB (이대리 src 100 파일 기준)
- [ ] 부팅 시 snapshot rebuild < 5초

---

## 한계 / 향후

- **macOS / Linux 만 검증** (WASM 동작 OK). Windows 미검증.
- **Tree-sitter chunk 정확도** PoC 수준 — 100% 보장 X. spec 으로 회귀 차단.
- **그래프 저장소** 인메모리 + JSON. 범위가 커지면 (≥1000 파일) Neo4j 검토.
- **순환 의존** 감지는 단계 4 에서 graceful 처리 (cycle 감지 시 skip + warn).

---

## 예상 commit 수

| 단계 | commit | 누적 |
|---|---|---|
| 0. 의존성 + 모듈 | 1 | 1 |
| 1. Chunker | 2 | 3 |
| 2. Relation Indexer | 2 | 5 |
| 3. 인메모리 그래프 + snapshot | 1 | 6 |
| 4. Query Usecase | 2 | 8 |
| 5. BE-3 통합 | 2~3 | 10~11 |

**총 10~11 commit, 1~2주 작업**.

---

## 진행 방식

각 단계 완료 후 사용자에게 결과 보고 + 다음 단계 진행 권한 받기. 본인이 자발적으로 다음 단계 진입 X. (메모리 `feedback_omc_team_workflow.md` 와 동일 정신.)

— 작성: Claude (Opus 4.7), 2026-04-29
