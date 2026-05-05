# 이대리 멀티 에이전트 비전 평가 — 외부 사례 검증 (2026-05-05)

> **목적**: 사용자가 구상한 5개 포지션(PM/BE/CTO/PO/CEO) 봇 시스템을 외부 검증된 사례와 비교하여 강점/공백/개선 후보를 정리.
> **방법**: 공식 출처(GitHub README, 공식 docs, arXiv 논문, 공식 가격 페이지) 만 인용. 미확인 항목은 `not verified` 로 명시. 추측·추론 차단.
> **운영**: 이 문서는 주기적 갱신 대상 ([§9](#9-주기적-관리-가이드) 참조).

---

## 1. 사용자 비전 (입력 그대로 — 평가 기준 ground truth)

### 포지션 5종

| 포지션 | 책임 |
|---|---|
| **PM** | GitHub / Notion / Slack / Gmail / Figma / Naver 등에서 TODO 수집 → 중복 제거 → 1일 TODO 합본. 개인적 용무는 사용자 입력 후 Notion 작성. |
| **BE** | 개발자 업무 할당받아 자율 개발. 다른 봇과 의사소통하며 최적화. CODE_RULE 준수. |
| **CTO** | BE ↔ PM 사이에서 기획적 챙김 + BE 업무 할당 + 코드 리뷰. BE 와 cross-check 하되 최종 결정은 CTO. |
| **PO** | 금일 한일 정량/정성 평가 + 피드백 + 이력서용 정리. 업무 리뷰 담당. |
| **CEO** | 전체 최종 결정자. PO 보고서 최종 평가 후 사용자에게 전달. BE↔CTO 컨텍스트 오염 주기 점검. 문서 퀄리티 점검. |

### 핵심 제약
- 1인 사용 (사용자 = owner = 운영자 = 청자)
- Slack 진입점 single
- Subscription-quota CLI (codex / claude) — API key X
- 한국어 도메인 (Naver 등 포함)

---

## 2. 검증 방법론

5개 병렬 document-specialist 에이전트에 다음을 강제:
- WebFetch 공식 출처 (GitHub README, official docs, arXiv) 만 인용
- 모든 항목에 출처 URL
- 미확인은 `not verified` 명시

조사 대상:
1. MetaGPT (SW dev role 가장 가까운 OSS)
2. ChatDev (가상 SW 회사 — CEO 포함)
3. Microsoft AutoGen (multi-agent conversation framework)
4. CrewAI (role+goal+backstory 추상화)
5. 멀티소스 PM 봇 카테고리 (Devin / OpenHands / Copilot Workspace / Linear AI / Notion AI / Geekbot / Glean / Lindy AI)

---

## 3. 외부 사례 — 검증된 사실 요약

### 3.1 MetaGPT (geekan/MetaGPT)

| 항목 | 검증된 사실 |
|---|---|
| 정의된 역할 | `ProductManager`, `Architect`, `ProjectManager`, `Engineer/Engineer2`, `QaEngineer`, `TeamLeader`, `DataAnalyst`, `Searcher`, `Sales` ([metagpt/roles/__init__.py](https://raw.githubusercontent.com/geekan/MetaGPT/main/metagpt/roles/__init__.py)) |
| **CEO/CTO/PO 역할** | **존재하지 않음** (canonical 명칭 기준 SW 개발 직책만) |
| 통신 메커니즘 | Publish-Subscribe + `Environment` 중앙 메시지 브로커. `_watch([ActionType])` + `publish_message(env)` ([base_env.py](https://raw.githubusercontent.com/geekan/MetaGPT/main/metagpt/environment/base_env.py)) |
| 워크플로우 | UserRequirement → PrepareDocuments+WritePRD → WriteDesign → 코드 → 테스트 ([software_company.py](https://raw.githubusercontent.com/geekan/MetaGPT/main/metagpt/software_company.py)) |
| Slack 통합 | `not verified` (공식 README/ROADMAP/docs 없음) |
| 라이선스 | MIT |
| 최근 release | **v0.8.2 (2024-03-09)** — 약 14개월 stale. 별도 상용 MGX 출시(2025-02). |
| 공식 한계 | "instructions 를 간혹 따르지 않아 코드 파싱 오류"; Python 3.9~3.12; 외부 서비스 인터페이스 없음(터미널 I/O 기반) |

### 3.2 ChatDev (OpenBMB/ChatDev)

| 항목 | 검증된 사실 |
|---|---|
| 정의된 역할 (1.0) | **CEO, CPO, CTO**, Programmer, Reviewer, Tester, Art Designer ([chatdev1.0 branch](https://github.com/OpenBMB/ChatDev/tree/chatdev1.0)) |
| 2.0(DevAll) 변화 | 사전 정의 X → 사용자가 YAML 로 정의 |
| 통신 메커니즘 | **Chat Chain** (subtask 노드별 두 역할 멀티턴 대화) + **Communicative Dehallucination** ([arXiv 2307.07924](https://arxiv.org/abs/2307.07924)) |
| 워크플로우 | Waterfall: **Designing → Coding → Testing → Documenting** |
| Git/GitHub | 지원 (`git_management` 설정) |
| Slack | `not verified` |
| 라이선스 | 코드 Apache 2.0 / 데이터 CC BY-NC 4.0 (비상업) |
| 최근 release | v2.2.0 (2026-03-23) — 활발 |
| 공식 한계 | Context 제한; phase 간 기술 불일치; 3D/영상 기능은 별도 설치 |

### 3.3 Microsoft AutoGen (microsoft/autogen)

| 항목 | 검증된 사실 |
|---|---|
| 핵심 추상화 | 3-layer: `autogen-core` / `autogen-agentchat` / `autogen-ext` |
| 역할 정의 | `AssistantAgent(name, description, system_message)` ([Teams Tutorial](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html)) |
| 통신 패턴 | `RoundRobinGroupChat`, `SelectorGroupChat`, `MagenticOneGroupChat`, `Swarm` (HandoffMessage) |
| 도구/시스템 | MCP (`McpWorkbench`), Tool Calling, `DockerCommandLineCodeExecutor`, gRPC 분산 |
| Slack 어댑터 | `not verified` (공식 채널 어댑터 없음) |
| 라이선스 | MIT |
| 최근 release | **v0.7.5 (2025-09-30)** |
| **상태** | **maintenance mode 진입** — 신규 기능 X. 신규 프로젝트는 **Microsoft Agent Framework** 권장 ([discussion #7066](https://github.com/microsoft/autogen/discussions/7066)) |
| 공식 한계 | 신뢰 못 할 MCP 서버 연결 금지; AutoGen Studio 는 prototyping only |

### 3.4 CrewAI (crewAIInc/crewAI)

| 항목 | 검증된 사실 |
|---|---|
| 핵심 추상화 | `Agent` / `Task` / `Crew` / `Process` / `Flow` ([docs.crewai.com](https://docs.crewai.com/introduction)) |
| 역할 정의 | `role` + `goal` + `backstory` 3개 필드 결합 ([agents](https://docs.crewai.com/concepts/agents)) |
| Process 종류 | `sequential` (default) / `hierarchical` (manager_llm 또는 manager_agent 필수) |
| 외부 도구 | GithubSearchTool, SerperDevTool, BrowserbaseLoadTool, PGSearchTool, FirecrawlSearchTool, ComposioTool 등 |
| **Slack built-in** | **공식 docs 미확인 — Composio 통합 통한 간접 가능성** |
| 라이선스 | MIT |
| 최근 release | **v1.14.4 (2026-04-30)** — 활발 |
| LangChain 독립 | "Built entirely from scratch, independent of LangChain" (공식 README) |
| 공식 한계 | 공식 docs 에 limitations 섹션 없음 — `not verified` (커뮤니티 정보는 조사 범위 밖) |

### 3.5 멀티소스 PM 봇 카테고리

| 도구 | 멀티소스 TODO 집계 | Slack 진입 | OSS | 비전 적합도 (사실 기반) |
|---|---|---|---|---|
| **Devin AI** | `not verified` | `not verified` | No (SaaS, Free~$200) | BE 일부 — GitHub 연동 O, Slack/Notion/Gmail/Figma `not verified` |
| **OpenHands** (All-Hands-AI) | `not verified` | `not verified` | MIT | BE 일부 — 코드 자율, 멀티에이전트 병렬, Slack bot `not verified` |
| **GitHub Copilot Workspace** | `not verified` | `not verified` | No | BE 일부 — GitHub 생태계 한정 |
| **Linear AI (Triage)** | Linear 내부 only | `not verified` | No | PM 트리아지 일부 — 외부 소스 수집 X |
| **Notion AI** | Notion + AI Connectors (Slack/Drive/Jira) | `not verified` | No ($10/멤버) | PM 문서화 일부 — 능동 TODO 생성 X |
| **Geekbot** | `not verified` | **O (핵심)** | No ($2.50/u, 10인↓ 무료) | Slack 스탠드업 한정 |
| **Glean** | GitHub/Slack/Gmail/Notion O | `not verified` | No (Enterprise) | 크로스소스 검색 — TODO 생성 `not verified` |
| **Lindy AI** | **Gmail/Slack/Notion O** | **O** | No ($50~$200/월) | **PM TODO 합본 가장 근접 — GitHub/Figma `not verified`** |

→ 사용자 비전 (멀티소스 TODO 중복 제거 + Slack + 5포지션 분리) **단일 커버 제품 존재 안 함** — 각각 부분 커버.

---

## 4. 비교 매트릭스 — 사용자 비전 vs 외부 사례

| 차원 | 사용자 비전 | MetaGPT | ChatDev (1.0) | AutoGen | CrewAI | Lindy AI |
|---|---|---|---|---|---|---|
| **CEO 역할 정의** | O | X | **O** | system_message 로 가능 | role 필드로 가능 | X |
| **CTO 역할 정의** | O | X | **O** | 가능 | 가능 | X |
| **PM 역할 정의** | O | **O (ProductManager)** | **O (CPO)** | 가능 | 가능 | 부분 (TODO 수집) |
| **BE/Engineer 역할** | O | **O** | **O (Programmer)** | 가능 | 가능 | X |
| **PO 역할 정의** | O | X | X (Reviewer 부분) | 가능 | 가능 | X |
| **Slack native 진입** | **O (필수)** | X | X | X | X (Composio 간접) | **O** |
| **GitHub/Notion/Gmail/Figma 통합** | **O (필수)** | X (외부 인터페이스 없음) | Git only | 가능 (Tool 직접 구현) | GithubSearchTool 외 직접 구현 | Gmail/Slack/Notion O / GitHub·Figma `not verified` |
| **에이전트 간 통신** | TBD | Pub/Sub via Environment | Chat Chain | Group chat 4종 | sequential / hierarchical | TBD |
| **워크플로우 시퀀스** | TBD | UserReq→PRD→Design→Code→Test | Designing→Coding→Testing→Documenting | round-robin / selector | sequential / hierarchical | event-driven |
| **컨텍스트 오염 점검 (CEO 역할)** | **O (CEO 책임)** | X | X | X | X | X |
| **이력서용 산출물 (PO 역할)** | **O (PO 책임)** | X | X | X | X | X |
| **한국어/Naver 통합** | **O (필요)** | `not verified` | `not verified` | 직접 구현 | 직접 구현 | `not verified` |
| **1인 single-user 인터페이스** | **O (필수)** | terminal I/O — 대화형 X | 대화형 X | API/SDK 통합 가능 | API/SDK 통합 가능 | **O** |
| **OSS / 자가호스팅** | **O (필수)** | MIT O | Apache 2.0 O / 데이터 CC-BY-NC | MIT O (단 maintenance mode) | MIT O | X |
| **최근 활성도** | — | 2024-03 stale | 2026-03 활발 | maintenance mode | 2026-04 활발 | SaaS active |

---

## 5. 사용자 비전 평가 (검증된 사실 근거)

### 5.1 강점 (외부 사례 대비 차별성, 사실 기반)

1. **CEO 의 메타-감독 역할** — 외부 5개 사례 중 어느 것도 "BE↔CTO 컨텍스트 오염 점검 + 문서 퀄리티 점검" 을 명시한 사례 없음. ChatDev 에 CEO 가 있지만 그 역할은 의사결정 헤드(Chat Chain 첫 단계) 일 뿐 메타-감독 아님 (출처: arXiv 2307.07924).
2. **PO 의 이력서용 산출 책임** — 외부 사례 중 미확인. PO 가 정량/정성 평가 + 이력서 정리는 **검증된 외부 선례 없음** (사용자 비전 고유).
3. **PM 의 멀티 소스 TODO 합본 (GitHub/Notion/Slack/Gmail/Figma/Naver)** — Lindy AI 가 가장 근접하나 GitHub/Figma `not verified`. **6개 통합 + 한국어/Naver 결합은 검증된 단일 외부 제품 없음**.
4. **Slack single 진입점 + 구독 CLI 사용** — 운영비를 API 기반 SaaS 들과 차별. Lindy/Glean/Devin/Copilot 모두 SaaS pricing.

### 5.2 공백 / 위험 (외부 사례가 해결한 것 중 비전이 미정의)

1. **에이전트 간 통신 메커니즘 미정의** — 네 사례 모두 명시적 메커니즘 보유 (Pub/Sub / Chat Chain / GroupChat / Process). 사용자 비전 "BE 와 의사소통" 만 명시. 어떤 토폴로지인지 결정 필요.
2. **워크플로우 시퀀스 미정의** — MetaGPT(SOP) / ChatDev(Waterfall) / CrewAI(sequential|hierarchical) 모두 명시. 사용자 비전은 "BE 자율 + CTO 최종결정" 만 — phase 정의 부재.
3. **컨텍스트 오염 점검 알고리즘 미정의** — CEO 책임이지만 "어떻게 감지하나" 미정. 외부 선례 없음 → 자체 정의 필요.
4. **PO 이력서 산출 schema 미정의** — 정량/정성 평가의 항목, 형식, 빈도 미정.
5. **CTO ↔ BE cross-check 후 최종 결정 메커니즘** — AutoGen Swarm 의 HandoffMessage 또는 CrewAI hierarchical Process 와 매핑 가능성 검토 필요.

### 5.3 비현실적 / 재고 권장

1. **Naver 통합** — 공식 외부 사례 미확인. 한국 서비스 통합은 자체 구현 부담 큼. 우선순위 재검토.
2. **Figma 통합** — 검증된 외부 사례 모두 `not verified`. PM 의 1차 멀티소스 set 에서 deferred 후보.
3. **5개 포지션 동시 도입** — 외부 사례 모두 phase 별 점진적 도입. 사용자 비전도 PM/BE/PO 부분 현 구현 → CTO/CEO 는 차후 단계로 분리 권장.

---

## 6. 검증 기반 개선 제안

> 추측 차단을 위해 모든 제안에 출처 사례 명시.

### 6.1 통신 메커니즘 — Pub/Sub 채택 검토 (출처: MetaGPT)
- 현재 [src/agent-run](../../../src/agent-run/) 의 EvidenceRecord 가 이미 메시지 로그성. MetaGPT 의 `_watch([ActionType])` 패턴으로 확장 시 자연스러움.
- BullMQ 가 이미 큐 인프라 — Pub/Sub 백엔드로 활용 가능.

### 6.2 CEO/CTO 역할 정의 — ChatDev 1.0 의 직함 매핑 차용 검토 (출처: ChatDev)
- ChatDev 의 CEO/CPO/CTO/Programmer/Reviewer/Tester 직함 → 사용자 비전 PM/BE/CTO/PO/CEO 와 5/7 매핑 가능. CPO 가 PM 에 가장 가까움.
- **단**, ChatDev 의 CEO 역할은 메타-감독 X 라 **사용자 비전의 CEO 는 ChatDev 와 동일 명칭 + 다른 책임**임을 plan 에 명시.

### 6.3 워크플로우 시퀀스 — CrewAI hierarchical Process 매핑 (출처: CrewAI)
- 사용자 비전 "최종 결정은 CTO" 는 CrewAI 의 `manager_agent` 와 동치. CTO = manager.
- BE 는 CrewAI Agent (worker), 하루 TODO = Tasks, 검증된 출력은 PO 가 평가.

### 6.4 PM 통합 우선순위 — Lindy AI 의 검증된 통합 6종 우선 (출처: Lindy AI)
- 검증된 핵심: Gmail / Slack / Notion. 이 셋부터.
- Linear 의 트리아지 패턴 (중복 감지/자동 라벨) — PM 의 "중복 제거" 책임 구현 시 차용 가능 (출처: linear.app/docs/triage-intelligence).
- Figma / Naver 는 검증 부족 → 보류 또는 우선순위 낮춤.

### 6.5 maintenance-mode 프레임워크 회피 (출처: AutoGen discussion #7066)
- AutoGen 0.x 는 maintenance mode. 사용자 시스템이 AutoGen 패턴을 차용해도 라이브러리 의존 X 권장.
- Microsoft Agent Framework 도 별도 평가 필요 (조사 범위 밖 — 차회 갱신 시).

### 6.6 라이선스 위험 — ChatDev 데이터셋 차용 시 비상업 제약 인지 (출처: ChatDev README)
- 사용자가 ChatDev 의 학습 데이터셋 사용 시 CC BY-NC 4.0 — 상업적 제약. 아키텍처/논문 차용은 무관.

### 6.7 컨텍스트 오염 점검 — 외부 선례 없음 → 자체 정의 후 plan 화
- 검증된 외부 선례 없으므로 추측 없이 자체 정의 필요.
- 후보: AgentRun 간 같은 슬래시 user 의 직전 N건 output 의 token-level overlap, 또는 inputSnapshot 의 prompt-key 충돌 점검.

---

## 7. 구체적 다음 단계 (이 문서 작성 시점 기준)

본 평가 결과를 받아들이는 경우 권장 plan 분기:

1. **에이전트 통신 토폴로지 선택 plan** — Pub/Sub via BullMQ vs Hierarchical via Manager Agent. 1주 결정.
2. **워크플로우 phase 정의 plan** — UserReq → PM → CTO 분배 → BE 실행 → PO 평가 → CEO 보고. 각 phase 의 입출력 schema.
3. **CEO/CTO 역할 신설 plan** — 현재 [src/agent](../../../src/agent/) 의 11개 에이전트에 CEO/CTO 추가. 의존성: 통신 토폴로지 결정 후.
4. **PM 멀티소스 통합 확장 plan** — Gmail 통합 추가 (Slack/GitHub/Notion 은 기 구현). Linear 트리아지 패턴 차용 검토.

각각 [docs/superpowers/plans/](../plans/) 에 별도 plan 문서로 분기.

---

## 8. 본 문서의 한계 / 미확인 영역

- **Microsoft Agent Framework**: AutoGen 후속이지만 본 조사 범위 밖. 차회 갱신 시 검증 필요.
- **CrewAI 의 limitations**: 공식 docs 명시 없음 — 커뮤니티/이슈 정보 미수집 (추측 차단).
- **Lindy AI 의 GitHub/Figma 통합**: 공식 가격 페이지에서 미확인. 별도 확인 필요.
- **ChatDev v2.2 (DevAll)**: YAML role 정의로 전환됐다는 사실까지만 확인 — 구체적 schema 미조사.
- **국내 (한국) 멀티 에이전트 사례**: 본 조사는 영문 공식 출처 중심. 한국 사례(Naver Clova, KT MiTalk 등)는 차회 갱신 후보.
- **MGX (MetaGPT 상용)**: 2025-02 출시 사실만 확인. 기능/가격 미확인.

---

## 9. 주기적 관리 가이드

### 9.1 갱신 주기

- **분기별 1회 (3개월)** 또는 다음 trigger 발생 시 즉시 갱신:
  - AutoGen → Microsoft Agent Framework 마이그레이션이 사용자 시스템에 영향
  - 새 외부 SOTA 출현 (예: 새 multi-agent 프레임워크 v1.0 출시)
  - 사용자 비전 자체 변경 (포지션 추가/삭제)
  - 라이선스 변경 (예: ChatDev 가 commercial use 허용)

### 9.2 갱신 항목

- 각 사례의 **최근 release 날짜 + 버전** 갱신 (가장 빠르게 stale)
- 각 사례의 **공식 한계점** 재확인 (새 docs 섹션 추가 가능)
- `not verified` 항목 중 새로 검증된 것 갱신
- 사용자 비전 변경 시 [§1](#1-사용자-비전-입력-그대로--평가-기준-ground-truth) 갱신 + [§4](#4-비교-매트릭스--사용자-비전-vs-외부-사례) 매트릭스 재계산

### 9.3 갱신 방법

새 정보 발견 시:
1. 본 문서의 해당 섹션을 **수정** (전체 재작성 X — diff 추적 가능하게)
2. 변경 이력은 [§10](#10-변경-이력) 에 한 줄 추가
3. 주요 결정이 따라온다면 별도 plan 문서로 분기 (`docs/superpowers/plans/{YYYY-MM-DD}-{slug}.md`)

### 9.4 검증 원칙 유지

차회 갱신 시에도 동일:
- 공식 출처 (GitHub README, official docs, arXiv, 공식 가격 페이지) 만 인용
- 출처 URL 모든 사실에 명시
- 미확인은 `not verified` — 추측 차단

### 9.5 본 문서가 아닌 곳에 가야 할 정보

- 사용자 본인의 의사결정 / 선택 → [docs/superpowers/plans/](../plans/) 의 dated plan
- 보류/철회 결정 → 별도 decision 문서 (예: `2026-04-30-mcp-rbac-decision.md` 패턴)
- 운영 중 발견한 한계 → [docs/superpowers/audits/](../audits/) 의 audit

---

## 10. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-05 | 최초 작성. 5개 외부 사례 검증 (MetaGPT / ChatDev / AutoGen / CrewAI / 멀티소스 PM 봇 카테고리). |

---

## 11. 출처 링크 (전체)

### MetaGPT
- [github.com/geekan/MetaGPT](https://github.com/geekan/MetaGPT)
- [docs.deepwisdom.ai/main/en](https://docs.deepwisdom.ai/main/en/guide/get_started/introduction.html)
- [Multi-Agent Tutorial](https://docs.deepwisdom.ai/main/en/guide/tutorials/multi_agent_101.html)
- [MetaGPT Releases](https://github.com/geekan/MetaGPT/releases)

### ChatDev
- [github.com/OpenBMB/ChatDev](https://github.com/OpenBMB/ChatDev)
- [chatdev1.0 branch](https://github.com/OpenBMB/ChatDev/tree/chatdev1.0)
- [arXiv 2307.07924](https://arxiv.org/abs/2307.07924)

### AutoGen
- [github.com/microsoft/autogen](https://github.com/microsoft/autogen)
- [microsoft.github.io/autogen/stable](https://microsoft.github.io/autogen/stable/)
- [discussion #7066 (maintenance mode)](https://github.com/microsoft/autogen/discussions/7066)
- [pypi: autogen-agentchat](https://pypi.org/project/autogen-agentchat/)

### CrewAI
- [github.com/crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)
- [docs.crewai.com](https://docs.crewai.com/introduction)
- [docs.crewai.com/concepts/agents](https://docs.crewai.com/concepts/agents)
- [docs.crewai.com/concepts/tools](https://docs.crewai.com/concepts/tools)
- [pypi: crewai](https://pypi.org/project/crewai/)

### 멀티소스 PM 봇
- [cognition.ai/blog/new-self-serve-plans-for-devin](https://cognition.ai/blog/new-self-serve-plans-for-devin)
- [github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)
- [githubnext.com/projects/copilot-workspace](https://githubnext.com/projects/copilot-workspace/)
- [linear.app/docs/triage-intelligence](https://linear.app/docs/triage-intelligence)
- [notion.so/help/notion-ai-connectors-beta](https://notion.so/help/notion-ai-connectors-beta)
- [geekbot.com/pricing](https://geekbot.com/pricing/)
- [glean.com/connectors](https://www.glean.com/connectors)
- [lindy.ai/pricing](https://www.lindy.ai/pricing)

— 작성: Claude (Opus 4.7) + 5개 병렬 document-specialist 에이전트, 2026-05-05
— 다음 갱신 권장 시점: 2026-08-05 (분기 1회) 또는 trigger 발생 즉시
