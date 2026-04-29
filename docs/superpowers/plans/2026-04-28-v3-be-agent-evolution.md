# P3/V3 Features: Backend (BE) Developer Agent Evolution (SOTA Edition)

현재 `2026-04-28-p2-features.md`에 계획된 P2 항목들을 넘어, 글로벌 최고 수준(State-of-the-Art)의 **자율형 SRE 및 BE 개발 에이전트**를 구축하기 위한 차세대 (P3/V3) 마스터플랜입니다. 

최신 2026년 리서치(AI SRE, AST 기반 RAG, MCP 보안 샌드박싱 트렌드)를 종합 반영하여, 단순한 '코드 제안 봇'을 넘어선 **안전하고(Safe), 문맥을 완벽히 이해하며(Context-Aware), 스스로 검증하는(Self-Verifying)** 100점짜리 "해결 루프(Resolution Loop)" 아키텍처를 제안합니다.

---

## 🎯 핵심 기술 기반 (The SOTA Foundations)

P3 기능을 안전하고 정확하게 구동하기 위해 우선적으로 도입해야 할 3대 코어 인프라입니다.

### 1. Code Graph 및 AST 기반 구조적 RAG (Structural RAG)
이대리의 엄격한 DDD 아키텍처(Port-Adapter 패턴)를 에이전트가 완벽히 이해하려면 단순 텍스트 검색(Vector RAG)으로는 부족합니다.
*   **Tree-sitter 기반 AST 청킹(Chunking):** 코드를 줄 단위가 아닌 함수/클래스(AST 노드) 단위로 쪼개어 임베딩합니다.
*   **코드 지식 그래프(Code Graph):** 클래스 상속, 인터페이스 구현(Port-Adapter), 함수 호출(Call graph) 관계를 그래프 DB(예: Neo4j)나 구조적 인덱스로 관리하여 에이전트가 "이 Port를 구현하는 Adapter를 찾아줘"와 같은 다중 홉(Multi-hop) 추론을 할 수 있게 합니다.

### 2. 안전한 격리 실행 환경 (Safe Execution Sandbox)
에이전트가 코드를 직접 수정하고 테스트(`pnpm test`)를 실행하려면 메인 호스트가 위험해집니다.
*   **MicroVMs (Firecracker) 또는 Hardened Docker:** 일회성(Ephemeral) 샌드박스 컨테이너를 띄워 에이전트가 코드를 빌드하고 테스트하도록 격리합니다.
*   **망 분리(Network Egress Filtering):** 에이전트 실행 환경에서는 허용된 API(GitHub, 내부 DB 등) 외의 외부 인터넷 접속을 차단합니다.

### 3. MCP (Model Context Protocol) 및 엄격한 RBAC
*   데이터베이스 접근, 쉘 명령어 실행, GitHub API 호출 등을 **MCP 서버**로 캡슐화합니다.
*   에이전트가 과도한 권한을 갖지 못하도록(Confused Deputy 방지) 작업 단위로 최소 권한(Least Privilege)만 부여합니다.

---

## 🚀 BE Agent V3 핵심 기능 발전 방향 (Resolution Loop)

### 1. BE-1: 능동형 에러 진단 및 RCA 에이전트 (Auto-SRE)
단순 Impact Report를 넘어 근본 원인 분석(RCA)과 핫픽스 코드를 제시합니다.
*   **Detect:** Datadog/Sentry Webhook 수신.
*   **Diagnose:** 에러 스택 트레이스를 파싱한 뒤, **Code Graph**를 순회하여 에러가 발생한 Usecase와 연관된 Port/Adapter 코드를 정확히 색인합니다.
*   **Plan & Verify:** 샌드박스 환경 내에서 에러를 재현하는 임시 테스트를 돌려보고, 수정 코드를 작성하여 `pnpm test` 통과 여부를 검증합니다.
*   **Action:** Slack 스레드에 원인 분석 결과와 함께 "안전 검증이 완료된 Fix PR Draft" 링크를 제공합니다.

### 2. BE-2: DDD 아키텍처 강제형 테스트 제너레이터 (AST-Aware Test Gen)
`CODE_RULES.md`를 시스템 프롬프트로만 주입하는 것을 넘어 구조적으로 강제합니다.
*   **동작 방식:** `/be-test <파일명>` 입력 시 트리거.
*   **AST 기반 컨텍스트 주입:** 대상 Usecase 파일의 AST를 분석해 내부에서 분기(`if`, `switch`)되는 모든 논리적 경로(Cyclomatic complexity)를 파악합니다.
*   **Mock 자동 생성:** 주입된 Port 인터페이스를 찾아내어 모든 메서드에 대한 완벽한 Jest Mock 객체를 자동 생성합니다.
*   **Self-Healing:** 샌드박스에서 테스트를 실행해보고 린트/타입 에러가 발생하면 에이전트가 스스로 코드를 수정(Self-Correction Rate 향상)한 뒤 완성된 `spec.ts`를 반환합니다.

### 3. BE-3: Prisma Schema Architect (Contextual DB Modeler)
단순 스키마 텍스트 편집이 아닌, 마이그레이션 영향도까지 분석하는 에이전트입니다.
*   **동작 방식:** `/be-schema "주문 취소 내역 테이블 추가"`
*   **영향도 분석:** 새로운 스키마 제안뿐만 아니라, 이 테이블 추가가 기존 관계형 모델(`schema.prisma`)과 기존 TS 타입(`@Prisma/client`)에 미치는 영향을 분석합니다.
*   **컨벤션 강제 검증:** 네이밍 룰(`@@map("snake_case")`), 인덱스 추가 누락 여부 등을 검증 파이프라인(Workflow-Integrated Validation)을 통해 한 번 더 필터링한 후 Schema Diff를 제공합니다.

### 4. BE-4: PR 리뷰 자동 수정 및 자율 반영 (Closed-Loop Auto-Remediation)
리뷰 코멘트를 남기는 QA-1을 넘어, 에이전트가 직접 브랜치를 따고 패치합니다.
*   **Git-Native Workflow:** 에이전트가 PR diff를 분석하여 `if`문 중괄호 누락, 매직 넘버 등 사소한 컨벤션 위반을 찾습니다.
*   **자동 수정 브랜치 생성:** 샌드박스에서 코드를 체크아웃 받아 직접 수정한 뒤, 백그라운드 임시 브랜치(`fix/agent-review-123`)로 푸시합니다.
*   **Human-in-the-loop (HITL):** Slack 메시지에 텍스트 코멘트와 함께 `[✅ 이 수정본으로 PR 덮어쓰기]` 인터랙티브 버튼을 제공합니다. 개발자는 코드를 짤 필요 없이 버튼 한 번 클릭으로 컨벤션 에러를 해결합니다.

---

## 📋 검토 및 결정 필요 사항 (Action Items)

1. **샌드박싱 인프라 도입:** 에이전트가 백그라운드에서 안전하게 `pnpm test`를 돌릴 수 있도록 **Docker 기반의 격리 실행 환경**을 구성하는 방향에 대한 타당성 검토.
2. **Code Graph / AST 파이프라인 구축:** 단순 텍스트 프롬프트를 넘어, 코드 구조를 파싱(Tree-sitter 등 활용)하여 RAG를 고도화하기 위한 아키텍처 조사 및 POC(개념 증명) 대상 선정.
3. **HITL (사람 승인) 정책 수립:** BE-4 처럼 에이전트가 GitHub 브랜치를 직접 수정(Write)하는 권한을 줄 때의 보안 정책 수립.
