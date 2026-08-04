# 운영 감사 후속 — 실행 0건 워커 판정과 런타임 불일치

**작성일** 2026-08-04 · **기준 커밋** `0c64828` (origin/main)
**갱신** 2026-08-04 — 산출물 테이블·게이트 env·런타임을 실측해 초판의 판정 세 건을 정정한다.

두 항목은 코드를 고치는 대신 **사실을 확정하는 것이 결론**이라 별도 문서로 남긴다.

---

## 1. 실행 0건 워커 5종 — 넷은 멀쩡하고, 하나는 진짜 고장이다

`BLOG` · `PREFERENCE_LEARNING` · `CONTRADICTION_JUDGE` · `DOCS_AUDIT_EVALUATOR` ·
`DOCS_AUDIT_OPTIMIZER` 다섯 워커가 실행 조회에서 0건으로 나와 처분 판정 대상으로 올라와 있었다.

초판은 이를 "주간 주기가 아직 오지 않았다"로 정리했으나, 산출물 테이블과 게이트 env 를 실제로
조회해 보니 **다섯이 서로 다른 이유로 0건**이었고 그중 하나는 구조적 결함이다.

### 초판의 잘못된 전제 — 주기는 이미 지나갔다

초판은 "화요일인 오늘 기준으로 아직 한 번도 발화할 차례가 없었다"고 적었다. 사실이 아니다.
`agent_run` 에 `ceo-meta`(일요일 18:00 cron)가 **2026-08-02 일요일에 성공으로 기록돼 있다.**
같은 일요일 사이클에 `knowledge-lint`(10:00) · `docs-sync-audit`(11:00) ·
`preference-learning`(12:00)도 발화할 차례였다. "주기 미도래"는 0건의 설명이 될 수 없다.

세 워커의 cron 은 Redis 에 정상 등록돼 있다(`bull:autopilot-cron:repeat` 실측).

| 그룹 | 등록된 패턴 | 타임존 |
|---|---|---|
| `knowledge-lint` | `0 10 * * 0` | Asia/Seoul |
| `docs-sync-audit` | `0 11 * * 0` | Asia/Seoul |
| `preference-learning` | `0 12 * * 0` | Asia/Seoul |

### 워커별 실측과 판정

| 워커 | 실측 근거 | 판정 |
|---|---|---|
| `BLOG` | `agent_run` 에 7건(`SLACK_MENTION_BLOG`, 성공 4 · 실패 3), 마지막 2026-06-25 | **경로 정상.** 원장에도 남는다. 최근 호출이 없었을 뿐 |
| `CONTRADICTION_JUDGE` | 밴드 쌍 1건을 실제 judge 에 태워 **6.5초 만에 정상 판정 수신**(`contradiction=false` + 사유 문자열). 소속 그룹 `knowledge-lint` 를 **수동 발화해 30.3초 완주 + Slack 보고 발송까지 확인**(§1.2) | **경로 정상 · 현재 작동 실증.** 과거 발화 이력만 소급 불가 |
| `DOCS_AUDIT_EVALUATOR` | `.env` 의 `DOCS_AUDIT_ENABLED="false"`(dotenv 실파싱 확인) | **꺼져 있다.** 고장이 아니라 비활성 |
| `DOCS_AUDIT_OPTIMIZER` | 같은 태스크 소속이라 동일 게이트에 걸린다 | **꺼져 있다** |
| `PREFERENCE_LEARNING` | env 는 `"true"` 인데 `preference_proposal` · `user_preference_profile` 모두 0건 | **진짜 고장**(§1.1) |

### 1.1 `PREFERENCE_LEARNING` — 첫 제안을 만들 경로가 없다

env 를 켜도 이 워커는 아무것도 만들지 않는다. 자기 산출물을 자기 입력으로 쓰기 때문이다.

1. 선호 신호원이 `ProposalDecisionSignalSource` **하나뿐**이다
   (`preference-profile.module.ts:32-35`).
2. 그 소스가 읽는 것은 `preference_proposal` 중 `APPROVED` / `REJECTED` 행이다
   (`preference-proposal.prisma.repository.ts:65`).
3. 신호가 0건이면 태스크는 제안을 만들지 않고 종료한다
   (`preference-learning.autopilot-task.ts:60-62`).

제안이 있어야 승인·거절 결정이 생기고, 결정이 있어야 다음 제안이 생긴다. **시작점이 없어서
이 순환은 돌지 않는다.** `preference_proposal` 0건은 그 결과다.

해소하려면 셋 중 하나가 필요하다 — 제안 이력에 기대지 않는 신호원을 하나 더 붙이거나(예: 최근
run 결과나 피드백 코멘트), 프로필이 비어 있을 때 쓰는 초기 제안 경로를 두거나, 첫 제안을 수동
으로 투입할 수단을 만드는 것.

### 1.2 `CONTRADICTION_JUDGE` — 지금은 돈다(실증), 과거만 소급 불가

**수동 발화 실증 (2026-08-04 14:59 KST).** 소속 그룹 `knowledge-lint` 를 BullMQ 큐에 job 하나로
투입해 실행 중인 앱의 worker 가 처리하게 했다.

| 관측 지점 | 결과 |
|---|---|
| worker 인수 | `processedOn` 즉시 기록 — 큐 경로 정상 |
| 완주 | `finishedOn` 기록, **30.3초**, `failedReason` 없음 |
| 완주 표식 | `autopilot:slot:knowledge-lint:manual-verify-...` 생성 |
| **발송 가드 키** | **`autopilot:knowledge-lint:2026-08-04` 생성** |

마지막 항목이 결정적이다. 오케스트레이터는 보낼 내용이 없으면(`items` · `previews` 모두 0)
가드 키를 만들지 않고 종료한다(`autopilot.orchestrator.ts:143-148`). **가드 키가 생겼다는 것은
`acquireOnce` 를 지나 Slack 보고가 실제로 발송됐다는 뜻이다.** 소요 30.3초도 단일 judge 호출
6.5초 × 최대 5쌍과 정합한다.

**결론 — 이 워커와 소속 태스크는 현재 정상 작동한다.**

그러나 **지난 일요일에 돌았는지는 여전히 어떤 기록으로도 판정할 수 없다.** 판정 결과가
어디에도 저장되지 않기 때문이다.

- 판정은 `KnowledgeLintIssue[]` 로 모여 Slack 요약 문자열이 될 뿐이다
  (`knowledge-lint.service.ts:78-86`).
- `episodic_memory` 는 이 워커의 **입력**이지 산출물이 아니다. 실제로 351건 전부
  `superseded_at` 이 null 이라 판정 흔적이 남지 않는다.
- 모순이 0건이면 Slack 보고에도 나타나지 않는다. "돌았는데 조용했다"와 "안 돌았다"가 구별되지 않는다.

**초판의 "각자 결말이 남는 곳이 따로 있다"는 이 워커에 대해서는 성립하지 않는다.**

그래서 과거를 따질 때는 소속 태스크 `knowledge-lint` 를 간접 지표로 쓴다. L1 중복 후보 쌍이
현재 **6,436건**이라 이슈 0건 skip 에 걸릴 수 없고, 따라서 **매주 일요일 10시에 중복 후보 보고가
Slack 으로 나가야 정상**이다. 위 실증이 그 보고가 정말 발송된다는 것까지 확인했으므로,
**일요일 10시 보고의 수신 여부가 곧 발화 여부**다.

### 원장 편입은 여전히 하지 않는다 — 대신 조회 방법을 고친다

원장을 안 거치는 네 워커를 `AgentRun` 에 편입하자는 안이 있었으나 채택하지 않는다. 원장은
결말을 한곳에서 보기 위한 것이지 모든 호출을 적기 위한 것이 아니다.

**단, "각자의 산출물 테이블을 보라"도 절반만 맞는 지침이다.** `CONTRADICTION_JUDGE` 처럼
산출물 자체가 없는 워커에는 적용되지 않는다. 자율 워커의 생사 판정은 세 가지를 함께 봐야 한다.

1. **산출물 테이블** — 있는 워커에 한해(`preference_proposal` 등)
2. **게이트 env 의 실제 값** — dotenv 파싱 기준. 값 뒤에 인라인 주석이 붙어 있어도 잘린 값이 적용된다
3. **스케줄 등록 상태** — `bull:autopilot-cron:repeat` 의 패턴

이번 조사에서 Redis 의 `autopilot:slot:*` 표식은 증거가 되지 못했다. TTL(수 시간~하루)이 있어
주간 태스크의 슬롯은 이미 만료됐고, BullMQ 완료 이력도 `removeOnComplete: 20` 이라
5분 주기 스윕이 전부 밀어낸 뒤였다. **상태 표식으로 과거를 판정할 때는 만료·정리 정책을
먼저 확인해야 한다.**

### 남은 확인

- `PREFERENCE_LEARNING` 은 §1.1 을 해소하지 않으면 다음 일요일에도 0건이다. 주기를 더 기다릴 이유가 없다.
- `CONTRADICTION_JUDGE` 는 §1.2 실증으로 현재 작동을 확인했다. 남은 것은 **2026-08-04 14:59 수동
  발화로 나간 Slack 보고가 실제로 도착했는지** 눈으로 확인하는 것뿐이다(발송은 가드 키로 확인됨).
- `DOCS_AUDIT` 두 종은 `DOCS_AUDIT_ENABLED` 를 켤지 결정하는 문제다. 워커 상태와 무관하다.
- `BLOG` 는 마지막 실행이 실패(2026-06-25)로 끝났으므로, 다음에 부를 때 성공하는지 확인한다.

---

## 2. Node 런타임 — 선언과 실행은 이미 맞다, 어긋난 것은 기본값과 타입이다

초판은 "실서비스가 선언보다 낮은 버전으로 돌고 있다"고 적었다. 사실이 아니다.

| 항목 | 값 | 확인 방법 |
|---|---|---|
| **실행 중인 백엔드** | **v22.23.1** | 프로세스가 연 실행 바이너리 직접 확인(`lsof` txt) |
| CI | 22 | `.github/workflows/ci.yml:31` |
| `package.json` `engines.node` | `>=22` | — |
| 대화형 셸 | v20.20.2 | `zsh -i` — nvm 기본 별칭 `20` 적용 |
| **비대화형 셸**(스크립트·launchd) | **v25.9.0** | `zsh -l -c` — nvm 이 로드되지 않아 homebrew node 사용 |
| `@types/node` | `^20.3.1` | `package.json` devDependencies |

서비스도 CI 도 이미 22 로 돌고 있다. **런타임 업그레이드는 필요 없다.** `engines` 를
낮추지 않는다는 판단도 그대로 유효하다 — Node 20 은 2026년 4월에 LTS 지원이 끝났다.

실제로 어긋난 것은 셋이다.

**하나, 이 머신에는 Node 가 세 버전 공존한다.** 어느 셸에서 재느냐로 답이 달라진다.
`.zshrc` 가 nvm 을 로드하지만 `.zshrc` 는 **대화형 셸에서만** 읽히므로, 스크립트·launchd 같은
비대화형 경로는 nvm 없이 `/opt/homebrew/bin/node`(v25.9.0)를 집는다. 초판의 "이 머신의
런타임은 v20" 은 대화형 셸 한 곳만 본 결과였다.

**둘, `.nvmrc` 만으로는 아무것도 자동으로 바뀌지 않는다.** 실측 — `.nvmrc` 에 `22` 를 둔
디렉터리로 `cd` 한 뒤에도 `node -v` 는 v20.20.2 였다. nvm 은 **디렉터리 진입 시 자동 전환
기능을 기본 제공하지 않고**, `.zshrc` 에 `chpwd` hook(nvm 문서의 "Deeper Shell Integration")도
없다. `.nvmrc` 는 인자 없는 `nvm use` 의 근거이자 선언으로서만 값이 있다.

따라서 이 저장소만으로 런타임 표류를 막을 수는 없다. 실효 조치는 둘 다 **저장소 밖 환경
변경**이라 여기서 하지 않는다.

- `nvm alias default 22` — 대화형 셸의 기본값을 옮긴다(가장 직접적)
- `.zshrc` 에 `chpwd` hook 추가 — 디렉터리별 자동 전환. 비대화형 경로는 여전히 안 덮인다

**셋, 타입 정의만 아직 Node 20 기준이다.** `engines` 는 `>=22` 인데 `@types/node` 는
`^20.3.1` 이다. 22 에서 추가된 API 는 타입이 없고, 20 에만 있는 API 는 걸러지지 않는다.
`^22` 로 올리는 것이 정합이지만 타입 변경은 빌드 영향이 있어 별도로 다룬다.
