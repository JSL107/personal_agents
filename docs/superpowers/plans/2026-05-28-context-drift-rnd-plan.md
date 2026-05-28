# Context Drift R&D Plan — CEO P5 Meta 정량화

> 작성: 2026-05-28 / 상태: draft (R&D 미진입) / scope: 단일 결정 기록
> 목적: PR #7 (CEO meta worker minimal) 의 follow-up — LLM 추론만이던 contextDriftReport.observations 를 정량 metric 기반으로 보강하기 위한 R&D 방향 결정.
> 운영: 결정 후 dated reference (사후 갱신 X). 신규 결정은 새 plan.

---

## 1. 배경

### 1.1 minimal 단계의 한계

PR #7 의 CEO worker (`src/agent/ceo/`) 는 minimal 단계로 구현됨 — `contextDriftReport.observations` 가 LLM 추론에만 의존.

LLM 추론 단독의 문제:
- **hallucination 위험**: LLM 이 실제 없는 drift 를 창작하거나, 실제 drift 를 놓칠 수 있음.
- **재현 불가**: 동일 입력에 동일 출력 보장 없음 — drift 감지 결과가 실행마다 달라짐.
- **신뢰성 한계**: "느낌" 기반 관찰이라 사용자 비전의 "감지자" 역할 수행 미흡.

schema 주석 (ceo.type.ts):
```ts
// schemaVersion=1 — 컨텍스트 오염 알고리즘은 외부 선례 없어 minimal 단계는 LLM 추론만.
// 향후 R&D plan 진입 시 contextDriftReport.observations 를 정량 metric 기반으로 보강 예정.
```

### 1.2 사용자 비전에서 CEO 의 역할

사용자 비전: **"사용자 → PM → CTO → BE → PO → CEO → 사용자"**

CEO (P5 Meta) 는 이 루프의 마지막 감시자 — PM 이 세운 plan 의 의도가 BE 실행과 PO 평가를 거치면서 얼마나 유지됐는지를 점검하는 "drift 감지자" 역할.

LLM 추론만으로는 이 역할을 정량적으로 수행하기 어려움.

---

## 2. 정의

**컨텍스트 드리프트 (Context Drift)**: PM plan 의 의도 (reasoning) 와 실제 BE 실행 결과 / PO_EVAL 평가 결과 간 일관성이 낮아지는 현상. 즉, "계획과 실행의 의미적 거리".

잠정 측정 단위: 0.0 (no drift) ~ 1.0 (full drift). threshold = 0.4 (초과 시 CEO 가 사용자에게 경고).

---

## 3. 외부 선례 조사

**유사 선례 없음** — CEO 가 multi-phase 워크플로우 전체의 의미 drift 를 정량 감지하는 LLM 에이전트 패턴은 공개된 사례 없음. 이 점이 본 R&D 가 needed 인 이유.

### 유사 개념 (직접 적용 불가, 참고용)

| 개념 | 설명 | 출처 |
|---|---|---|
| LLM hallucination scoring | RAG 시스템에서 생성 결과와 검색 문서 간 factual consistency 점수화 (예: RAGAS faithfulness metric). 0.0~1.0. | [RAGAS paper, arXiv 2309.15217](https://arxiv.org/abs/2309.15217) |
| Agent context window fragmentation | AutoGen / LangGraph 에서 long-horizon task 중 이전 스텝 context 가 소실되는 현상 분석 (정량화 방법론 미확립). | [AutoGen blog, 2024](https://microsoft.github.io/autogen/stable/) |

→ RAGAS 의 faithfulness metric 은 "생성 답변 vs 검색 문서" 유사도 측정 — 이대리의 "PM plan 의도 vs BE 실행 결과" 구조와 유사. 직접 재사용 가능성 검토 필요.

---

## 4. 잠정 Metric 후보

### 4.1 plan-execution diff

**정의**: PM plan 의 morning/afternoon task title 과 실제 CTO 분배 task title 의 lexical/semantic 유사도.

```
drift_score = 1 - similarity(pm_task_titles, cto_assignment_task_titles)
```

- low diff (similarity > 0.8) → no drift → CEO 가 "계획 실행 일치" 판정.
- high diff (similarity < 0.5) → drift 신호 → CEO 가 "계획 이탈 감지" 경고.

구현 후보: cosine similarity (TF-IDF 또는 embedding). 임베딩은 외부 API 의존 없이 `node-nlp` 또는 CLI 내 임베딩 고려.

### 4.2 assignment confidence drop

**정의**: CTO 분배 결과의 `confidence < 0.6` 비율 (현재 schema 에 confidence 필드 미존재 → schema 확장 필요).

```
confidence_drop_rate = count(assignments where confidence < 0.6) / total_assignments
```

- low rate (< 0.2) → 자동화 가능 신호 → no drift.
- high rate (> 0.5) → CTO 가 판단 불확실 → drift 신호.

**선결 조건**: `src/agent/cto/domain/cto.type.ts` 의 `Assignment.confidence` 필드 추가 (별도 PR).

### 4.3 PO_EVAL win/blocker 균형

**정의**: PO_EVAL 출력의 blockers 수 대비 wins 수 비율.

```
wb_ratio = blockers.length / max(wins.length, 1)
```

- wb_ratio < 1.0 → wins 우세 → no drift.
- wb_ratio > 2.0 → blockers 가 wins 의 2배 초과 → phase 흐름 이상 신호.

이 metric 은 별도 LLM 호출 없이 현재 PO_EVAL output schema 로 즉시 계산 가능 (가장 구현 비용 낮음).

---

## 5. 검증 절차

### 5.1 성공 지표

본 R&D 의 성공 = **minimal CEO 의 LLM observations 와 위 metric 의 사용자 평가 일치도 > 70%**.

구체적으로:
1. minimal CEO 를 4주 이상 실운행 → `contextDriftReport.observations` 누적.
2. 위 3개 metric 을 같은 기간 사후 계산 (코드 구현 없이 데이터만).
3. 사용자가 각 주차의 CEO observations 와 metric 결과를 비교 평가.
4. 일치 주차 / 전체 주차 > 0.7 → metric 도입 가치 확인.

### 5.2 데이터 요건

- 최소 **4주 phase loop run** (P1 → P2 → P3 → P4 → P5 full cycle 4회).
- 각 주차 AgentRun 레코드 보존 필수 (현재 `AgentRun` DB 테이블 보존 중 — 삭제 X).

---

## 6. Scope 제한

| 항목 | 포함 | 제외 |
|---|---|---|
| 본 R&D plan 문서 | ✅ | |
| metric 후보 정의 | ✅ | |
| 코드 구현 | | ✅ (별도 plan) |
| CTO confidence 필드 추가 | | ✅ (§4.2 선결 조건, 별도 PR) |
| 임베딩 모델 선정 | | ✅ (데이터 축적 후 결정) |
| 자동 threshold 조정 | | ✅ (데이터 없이 결정 불가) |

**코드 진입 조건**: 최소 4주 phase loop run + 사용자 검증 일치도 확인 후. 그 이전에 코드 구현 시작 X.

---

## 7. 다음 액션

1. minimal CEO 실운행 시작 — 데이터 축적.
2. 4주 후 §5.1 검증 절차 실행.
3. 검증 통과 시 신규 plan 작성 (`2026-??-??-context-drift-impl-plan.md`) + 코드 구현 진입.

---

## 8. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-28 | 최초 작성. PR #7 follow-up. metric 후보 3개 + 검증 절차 정의. |

— 작성: Claude (Sonnet 4.6), 2026-05-28
— 갱신 trigger: 결정 변경 또는 후속 plan 진입 시 (사후 갱신 X — 신규 파일 생성)
