# 운영 감사 후속 — 실행 0건 워커 판정과 런타임 불일치

**작성일** 2026-08-04 · **기준 커밋** `693dd81` (origin/main)

두 항목은 코드를 고치는 대신 **사실을 확정하는 것이 결론**이라 별도 문서로 남긴다.

---

## 1. 실행 0건 워커 5종 — 폐기 대상은 없다

`BLOG` · `PREFERENCE_LEARNING` · `CONTRADICTION_JUDGE` · `DOCS_AUDIT_EVALUATOR` ·
`DOCS_AUDIT_OPTIMIZER` 다섯 워커가 실행 원장에 잡히지 않아 처분 판정 대상으로 올라와 있었다.

조사해 보니 **"실행 0건"은 워커가 죽었다는 뜻이 아니다.** 서로 다른 두 가지가 겹쳤다.

### 원인 A — 원장에 안 남는다

다섯 워커 모두 `AgentRun` 을 만들지 않는다. 실제로 `agent_run` 테이블에 나타나는 것은
27종 중 19종뿐이다. 원장을 안 거치는 워커는 아무리 잘 돌아도 이 조회에서 0건으로 보인다.

### 원인 B — 주간 주기가 아직 오지 않았다

네 워커가 일요일 cron 소속이고(`knowledge-lint` · `docs-sync-audit` · `preference-learning`),
활성 env 는 최근에 켜졌다. 화요일인 오늘 기준으로 아직 한 번도 발화할 차례가 없었다.

### 워커별 실측과 판정

| 워커 | 실측 근거 | 판정 |
|---|---|---|
| `BLOG` | `preview_action` 의 `EVENING_BLOG_PUBLISH` 8건, 마지막 2026-08-03 | **정상 동작 중.** 원장에만 안 남는다 |
| `PREFERENCE_LEARNING` | `preference_proposal` 0건 · `user_preference_profile` 0건. env 설정됨, 일요일 cron | 아직 미발화. 다음 일요일 발화로 확인 |
| `CONTRADICTION_JUDGE` | 주간 `knowledge-lint` 소속. `episodic_memory` 346건은 전체 합계라 이 워커 몫으로 특정할 수 없다 | 미확정. 다음 일요일 발화로 확인 |
| `DOCS_AUDIT_EVALUATOR` | 주간 `docs-sync-audit` 소속 | 아직 미발화 |
| `DOCS_AUDIT_OPTIMIZER` | 주간 `docs-sync-audit` 소속 | 아직 미발화 |

### 원장 편입은 하지 않는다

다섯 워커를 `AgentRun` 에 편입하자는 안이 있었으나 필요하지 않다. 각자 결말이 남는 곳이
이미 따로 있기 때문이다 — `BLOG` 는 PreviewGate 카드, `PREFERENCE_LEARNING` 은
`preference_proposal`, `CONTRADICTION_JUDGE` 는 `episodic_memory`, `DOCS_AUDIT` 두 종은
Slack 보고다. 원장은 결말을 한곳에서 보기 위한 것이지 모든 호출을 적기 위한 것이 아니다.

**단, 조회 방법은 바꿔야 한다.** `agent_run` 만 보고 "이 워커는 안 돈다"고 판단하면 이번처럼
오진한다. 자율 워커의 생사는 각자의 산출물 테이블로 확인한다.

### 남은 확인

다음 일요일 cron 이후 `preference_proposal` · `docs-sync-audit` Slack 보고에 기록이 생기는지
본다. 그때도 0건이면 그때는 진짜 고장이므로 다시 판정한다.

---

## 2. Node 런타임이 선언과 다르다 — 선언을 유지한다

| 항목 | 값 |
|---|---|
| 이 머신의 런타임 | `v20.20.2` |
| `package.json` `engines.node` | `>=22` |
| 게이트 영향 | 경고만 내고 `lint:check` · `build` · `test` 모두 통과 |

즉 지금 실서비스가 선언보다 낮은 버전으로 돌고 있다.

**선언(`>=22`)을 낮추지 않는다.** Node 20 은 2026년 4월에 LTS 지원이 끝났고, EOL 버전을
공식 지원 범위로 되돌리는 것은 후퇴다. 저장소 가이드도 22 이상을 전제로 쓰여 있다.

맞춰야 할 쪽은 런타임이다. 다만 로컬 Node 업그레이드는 이 저장소 밖의 환경 변경이라
여기서 처리하지 않고 사실만 기록해 둔다. 업그레이드 전까지는 "게이트가 통과했다"가
"선언한 런타임에서 통과했다"를 뜻하지 않는다는 점을 감안해야 한다.
