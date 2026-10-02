# 저녁 메시지 중복 정리 — 설계 초안

- 작성일: 2026-10-02 (같은 날 개정 1회)
- 상태: 초안 (구현 전) — 결정 확정: F만 진행, D′ 보류 / 저녁 회고 프롬프트 변경은 KPT 판정 뒤
- 선행 작업: 저녁 메시지 다이어트 — ⓐ 블로그 전문을 링크로 ⓑ 정량 근거·careerLog 스레드 합치기 ⓒ 판정 댓글을 저녁 회고 첫 스레드로 (`.omc/handoffs/2026-10-02-evening-digest/A-implement.md`의 1·2·3)

> **한 줄 요약** — 메인 중복의 원천은 PO 평가 블록이다. 1단계로 PO 평가의 요약·Wins·Blockers를 메인에서 스레드로 내린다(안 F, 프롬프트 변경 없음). 「새 통합 요약」이 그래도 필요하면 2단계로 저녁 회고 **뒤에** 별도 정리 단계를 붙인다(안 D′). 저녁 회고 프롬프트에 정리를 얹는 안(B)은 아직 내려지지 않은 KPT 판정과 판정 버튼의 실행 귀속을 깨뜨리므로 권하지 않는다.

## 1. 무엇이 문제인가

저녁 19:05 메시지는 네 task(업무 회고 → PO 평가 → 저녁 회고 → 블로그 발행)의 요약을 이어 붙인 것이다(`src/autopilot/application/autopilot.orchestrator.ts:358-360`). 2026-10-01 회차 기준으로 메인에 올라간 섹션은 다음과 같다.

| 메인 섹션 | 만드는 곳 | 스레드로 가는 것 |
|---|---|---|
| 업무 회고 「오늘 한 일」·「한 줄 성과」 | `src/slack/format/daily-review.formatter.ts:11-17` | 정량 근거·질적 영향·결정·**위험·다음 액션** |
| PO 평가 요약 한 줄·🏆 Wins·🚧 Blockers | `src/slack/format/po-evaluation.formatter.ts:17-34` | careerLog |
| 저녁 회고 KPT 네 칸 + 후보 3건 | `src/autopilot/infrastructure/tasks/evening-retro-publish.autopilot-task.ts:222-230` | 후보 전체 |

업무 회고의 「위험」·「다음 액션」은 원래 스레드에 있다. 그러니 메인에서 같은 사실이 되풀이되는 것은 매번 PO 평가 블록이 끼기 때문이다.

- PR 28건 등: 「오늘 한 일」 + PO Wins
- staging smoke 공백: PO 요약 한 줄 + PO Blockers + KPT 「문제」
- PR #52 대기: PO Blockers + KPT 「미완」

길이도 따져 봐야 한다. `logs/slack-send.jsonl`의 2026-10-01 10:05Z 회차를 보면 메인은 1,823자다. 스레드·카드는 정량 근거 792, careerLog 561, 후보 전체 1,766, 블로그 전문 1,505, 블로그 카드 452, 경력 카드 2,362, 발행 미리보기 653자다. 합계 약 9,900자 가운데 메인은 약 18%다. 「길다」의 대부분은 스레드와 카드에 있고, 그중 블로그 전문과 숫자 중복은 선행 작업 ⓐ·ⓑ가 다룬다. 이 문서가 다루는 메인 정리는 체감 길이 중 일부에만 해당한다.

원인은 에이전트들이 서로를 몰라서가 아니다. PO 평가는 업무 회고 결과를 입력으로 받고(`src/agent/po-eval/application/generate-po-evaluation.usecase.ts:194-229`), 저녁 회고는 두 결과를 다시 읽는다(`evening-retro-publish.autopilot-task.ts:151-158, 374-389`). 받은 내용을 각자 자기 말로 다시 요약하고, 그 결과가 모두 메인에 오른다.

## 2. 설계를 가른 결정

| 질문 | 결정 |
|---|---|
| 저녁 메시지로 하는 일 | 훑어보기, 판정 버튼, 승인 카드, 내일 계획 참고. 넷 다 한다 |
| 메인에 남길 목소리 | 새 통합 요약 하나 (§10-1에서 재확인 필요) |
| 수정 범위 | 프롬프트까지 바꿀 수 있다 |
| 판정 버튼 관측 | 저녁 회고 형식을 바꿔도 되고, 누름률 관측은 다시 시작해도 된다 (KPT 「문제」 칸 존폐 판정까지 포함하는지는 §10-2에서 재확인 필요) |

## 3. 소비자 지도 — 무엇을 바꾸면 무엇이 깨지는가

**저녁 그룹 네 task에 한해서는** 메인·스레드 문자열(summaryText·detailText)이 원장에 저장되지 않고, 이를 읽는 소비자도 없다. 아래 소비자들은 모두 `agent_run.output`(`prisma/schema.prisma:24`)의 구조화 JSON을 읽는다. 따라서 저녁 그룹의 화면 배치만 바꾸면 원장 소비자는 깨지지 않는다.

이 성질은 모든 task에 성립하지는 않는다. `docs-sync-audit`(저녁 그룹 아님)은 메인 요약을 승인 카드 문구에 그대로 넣는다(`src/autopilot/infrastructure/tasks/docs-sync-audit.autopilot-task.ts:101-108`). 승인 카드 문구는 `preview_action.preview_text`에 저장되며(`prisma/schema.prisma:111-112`), 지연 보고(`src/agent/delay-report/domain/attribute-delay.ts:174`), 비서실 다이제스트(`src/autopilot/domain/secretariat.digest.ts:130`), 선호 학습(`src/preference-profile/infrastructure/preview-decision.signal-source.ts:82`), 콘솔(`src/console/application/console-mappers.ts:30-34`)이 읽는다. 저녁 회고의 블로그·경력 카드 문구는 메인 요약과 상관없이 따로 조립된다(`evening-retro-publish.autopilot-task.ts:265, 291`). 그래도 어느 안이든 **카드 문구는 건드리지 않는다**를 제약으로 둔다.

| 원장 | 소비자 | 읽는 필드 | 근거 |
|---|---|---|---|
| WORK_REVIEWER (`DailyReview`) | PO 평가(같은 저녁) | output 전체 JSON, 2,000바이트에서 자름 | `generate-po-evaluation.usecase.ts:135, 202, 226-229`, `po-eval-system.prompt.ts:3` |
| | 저녁 회고(같은 저녁) | output 전체 JSON, 자르지 않음 | `evening-retro-publish.autopilot-task.ts:387-388` |
| | 다음날 아침 PM | 모든 필드 | `src/agent/pm/application/daily-plan-context.collector.ts:250-263`, `src/agent/pm/domain/prompt/previous-worklog-formatter.ts:19-55` |
| PO_EVAL (`EvaluationOutput`) | 저녁 회고(같은 저녁) | output 전체 JSON | `evening-retro-publish.autopilot-task.ts:155-158` |
| | CEO 메타(일 18:00) | 범위 안 **최신 1건**(`limit: 1`), 2KB에서 자름. 실제로는 주로 토요일 저녁 평가 하루치 | `src/agent/ceo/application/generate-ceo-meta.usecase.ts:108-122`, `ceo-system.prompt.ts:3, 17` |
| | 이력서 careerLog → Notion | `careerLog`. 승인 카드는 수동 `/po-eval`에서만 생긴다 | `po-eval-careerlog.applier.ts:45-60`, `src/slack/handler/phase-command.handler.ts:107` |
| EVENING_RETRO (`EveningRetroResult`) | 다음날 아침 PM | **최신 1건**의 `retrospective.carryOver·tryNext` | `daily-plan-context.collector.ts:267-302`, `src/agent/pm/domain/prompt/evening-retro-formatter.ts:34-65` |
| | 판정 버튼 | `retrospective.problem` 유무로 축 결정. 라벨은 「회고 전체」 | `evening-retro-publish.autopilot-task.ts:297-307`, `src/agent-run/domain/run-verdict.ts:15-19` |
| | 계약 머리말·계약 점수 | `deliverableFields: ['prNotes','candidates','retrospective']` | `src/agent-registry/agent-contract.ts:387-395`, `src/model-router/application/model-router.usecase.ts:108` |
| 모든 성공 run | episodic memory | output 전체를 적재하고, few-shot에서는 앞 100자만 표시 | `src/agent-run/application/agent-run.service.ts:480-507`, `src/router/application/intent-classifier.usecase.ts:36, 77` |

**블로그 근거**는 카드에 고정된 payload만 읽는다(`src/agent/blog/infrastructure/evening-blog-publish.applier.ts:52-84`). 다만 후보·prNotes·KPT가 **한 프롬프트와 한 번의 호출**에서 나온다(`src/agent/blog/domain/prompt/evening-retro.prompt.ts:86-101`, task `187-198`). 그래서 저녁 회고 프롬프트를 고치는 안은 블로그 후보 품질에도 영향을 준다.

## 4. 후보안

### A. 메인에는 저녁 회고만 — 업무 회고·PO 평가를 모두 스레드로

- 깨지는 소비자: 없다.
- 판정 관측: 영향 없다.
- 한계: 「오늘 한 일」까지 사라져 훑어보기가 스레드를 열어야 하는 일이 된다. 결정 2도 만족하지 못한다. 줄이려던 중복은 PO 블록에서 나오는데 업무 회고까지 빼는 것은 과하다.

### F. PO 평가 블록만 메인에서 스레드로 (1단계 권장)

저녁 자동 task(`src/autopilot/infrastructure/tasks/po-eval.autopilot-task.ts`)에서 PO 평가의 요약 한 줄·Wins·Blockers를 detail 맨 앞으로 옮긴다. 포매터(`po-evaluation.formatter.ts`)는 수동 `/po-eval`·재시도·라우터 경로도 함께 쓰므로 고치지 않는다. 메인에는 `📊 PO 평가 — 스레드` 정도의 한 줄만 남긴다. 오케스트레이터는 summaryText가 있어야 detail도 보내므로(`autopilot.orchestrator.ts:210`) 한 줄 요약은 남겨야 한다. 메인은 「오늘 한 일」(사실) + KPT(반성) + 후보 3건이 된다.

- 변경 범위: `po-eval.autopilot-task.ts`와 해당 spec. 포매터·프롬프트·오케스트레이터는 바꾸지 않는다.
- 유실 방지: 상세가 그날 평가의 유일한 사본이 되므로 task가 `detailIsOnlyCopy`를 켠다. 오케스트레이터는 스레드 댓글이 실패하거나 메인 ts가 없으면 그 상세를 채널에 한 번 더 올린다(유실 대신 중복). 그림 회차 요약에 쓰던 기존 대피 경로를 그대로 쓴다.
- 깨지는 소비자: 없다. PO_EVAL 원장이 그대로다.
- 판정 관측: 영향 없다. PO_EVAL은 판정 버튼 대상이 아니다.
- 기대 효과: 위 세 사실이 메인에 각각 한 번씩만 나온다. 다만 「오늘 한 일」 본문이 위험을 언급하거나 KPT 「문제」와 「미완」이 같은 사실을 다루면 겹침이 남는다. 이는 10-01 원장으로 확인하지 못했다(§9).
- 한계: 결정 2(새 통합 요약)를 문자 그대로 만족하지는 않는다. 메인은 두 목소리로 남는다.

### B. 저녁 회고 프롬프트에 「오늘의 정리」(digest)를 얹는다 (초판 권장안, 철회)

`EveningRetroResult`에 `digest`를 추가하고 메인을 digest + KPT로 바꾸는 안이다. 검토 결과 다음 결함이 확인되어 권장을 철회한다.

1. **아직 내려지지 않은 판정을 지운다.** KPT 설계는 「문제」 칸이 지어낸 것인지 7영업일 동안 사람이 판정하고, 3건 이상이면 칸을 걷어내기로 했다(`2026-09-18-evening-retro-kpt-design.md:95-104`). 그런데 그 판정은 기록할 자리가 없어 한 번도 내려지지 않았다(`2026-09-30-human-feedback-channel-design.md:88-94`). 피드백 설계는 저녁 회고 프롬프트 수정을 「판정이 쌓인 뒤 판단한다」며 범위 밖에 두었다(같은 문서 §8). B는 risks와 problem을 가르려고 problem의 정의를 판정 전에 바꾼다.
2. **판정이 엉뚱한 실행에 귀속된다.** 「회고 전체」 버튼(`run-verdict.ts:15-19`)이 업무 회고·PO 평가 사실을 옮겨 적은 digest까지 판정하게 된다. digest의 틀린 사실에 누른 👎는 EVENING_RETRO 실행에 붙는다. 이는 피드백 설계가 버튼을 고른 이유인 「실행 단위 정확 귀속」을 무력화한다.
3. **성공 기준이 자기 정의 때문에 깨진다.** risks를 「대기 중인 응답」으로, carryOver를 「열린 PR」로 정의하면(`evening-retro.prompt.ts:95`) PR #52는 두 칸 모두에 들어간다.
4. **블로그 후보·경력 카드와 같은 호출에 묶인다.** 이 호출은 출력 형태 강제(`--output-schema`) 목록에 없다(`model-router.usecase.ts:147-151`). 입력 길이 상한도 없다. 실패하면 catch가 한 줄 텍스트만 돌려주고(`evening-retro-publish.autopilot-task.ts:309-316`) 경력 카드가 사라진다. 그날 머지한 PR은 다음 회차 조회 범위 밖이라 영영 반영되지 않는다(`autopilot-task.port.ts:24-26`). 실측 성공률이 14/14이므로 위험 크기는 중간이다.
5. **새로 만들어야 할 장치가 문서 초판에 빠져 있었다.** 메인을 빼고 스레드에만 올리는 경로가 없다(`orchestrator.ts:210`). 파서는 모르는 키를 조용히 버린다(`evening-retro.prompt.ts:180-216`). 계약의 `deliverableFields`도 갱신해야 한다(`agent-contract.ts:393`). 실패 시 폴백 신호도 새로 만들어야 한다.

### C. 역할 재정의 — 각 단계가 앞 단계를 되쓰지 않게

- 깨지는 소비자: careerLog 재료가 약해진다. CEO 메타도 약해지지만, 실제로 읽는 것은 하루치 1건·2KB이므로(§3) 피해는 작다.
- 판정 관측: 저녁 회고 프롬프트를 고치므로 B의 1·2번 결함을 그대로 갖는다.
- 한계: 결정 2를 만족하지 못하고, 겹침 방지를 프롬프트 지시에만 맡긴다.

### D′. 저녁 회고 뒤에 전용 정리 단계 추가 (2단계 후보)

블로그 발행 앞이나 뒤에 새 task와 새 `AgentType`을 둔다. 이 단계는 업무 회고·PO 평가 원장, 그리고 **저녁 회고 KPT까지** 입력으로 받는다. 「KPT에 있는 사실은 되풀이하지 않는다」는 규칙으로 메인의 「오늘의 정리」를 쓴다. 메인은 정리 + KPT + 후보 3건이고, 업무 회고 요약은 스레드로 간다. 초판의 D는 회고까지 스레드로 내려 판정 버튼 위치 문제를 만들었는데, D′는 회고를 메인에 남긴다.

- 깨지는 소비자: 없다. 기존 원장과 프롬프트는 모두 그대로다.
- 판정 관측: 저녁 회고 프롬프트와 판정 축이 그대로다. 정리 단계가 틀리면 그 판정은 정리 단계의 실행에 따로 귀속할 수 있다.
- 비용: 구독 쿼터 1회/일(금액 비용 아님, CLAUDE.md §0). AGENTS.md §4 체크리스트 중 `AgentType` exhaustive 4곳, `TriggerType`, `/retry-run`, `ResponseCode`가 해당한다. 초판의 기각 근거 「워커 폐지 흐름과 반대」는 틀렸다. #719의 폐지 기준은 「30일 실행 0건」이고, 매일 도는 단계는 그 기준에 걸리지 않는다.
- 주의: 비용을 줄이려고 `EVENING_RETRO` AgentType을 재사용하면 안 된다. PM이 최신 1건의 `retrospective`만 읽으므로(`daily-plan-context.collector.ts:276-288`) 전날 회고가 사라진다.
- 블로그 발행 상태는 정리 단계를 블로그 발행 뒤에 둘 때만 반영할 수 있다.

### E. 오케스트레이터에서 겹치는 줄을 기계적으로 제거 (탈락)

LLM은 같은 사실을 매번 다르게 표현하므로 정확 일치로는 거의 걸리지 않는다. 유사도를 쓰면 다른 사실까지 지울 수 있고, 무엇이 지워졌는지 사람이 알 수 없다.

## 5. 비교

| | A | **F (1단계)** | B | C | **D′ (2단계)** |
|---|---|---|---|---|---|
| 통합 요약 하나(결정 2) | ✗ | △ 두 목소리 | ○ | ✗ | ○ |
| 메인 세 사실 중복 해소 | ○ | ○ (본문 겹침 미확인) | ✗ PR #52 2회 | △ | ○ (규칙 의존) |
| 깨지는 원장 소비자 | 없음 | 없음 | 블로그 후보 품질 결합 | careerLog 약화 | 없음 |
| KPT 판정·판정 귀속 | 보존 | 보존 | **훼손** | **훼손** | 보존 |
| 추가 LLM 호출 | 0 | 0 | 0 | 0 | +1/일 (쿼터) |
| 변경 범위 | 포매터 2 | 저녁 task 1 + 상세 대피 플래그 | 프롬프트·파서·윤문·계약·오케스트레이터 | 프롬프트 3 | 새 워커 |

## 6. 권장과 근거

**1단계 F를 먼저 한다.** 메인 중복의 원천인 PO 블록만 옮기므로 원장, 프롬프트, 판정 관측 어느 것에도 영향이 없다. 변경은 저녁 자동 task 하나(포매터는 그대로)와 상세 대피 플래그이고 되돌리기도 쉽다.

**2단계 D′는 F 결과를 보고 정한다.** 다음 두 조건 중 하나를 만족할 때 착수한다.
- F 적용 뒤 몇 회차를 보았는데도 「오늘 한 일」과 KPT가 겹치거나, 사용자가 여전히 한 덩어리 요약을 원한다.
- KPT 「문제」 칸 판정(KPT 설계 §3-2)이 내려졌다.

D′는 저녁 회고를 건드리지 않으므로 판정과 순서가 묶이지는 않는다. 하지만 메인 형식이 바뀌면 누름률 관측의 기산일이 바뀐다.

**B·C는 권하지 않는다.** 둘 다 아직 내려지지 않은 KPT 판정의 대상(「문제」 칸)을 판정 전에 바꾼다.

## 7. 순서와 의존

1. 선행 작업 ⓐ·ⓑ·ⓒ를 먼저 머지한다. F는 `po-eval.autopilot-task.ts`를 건드리는데 ⓑ도 같은 파일을 고치므로, 선행 작업 브랜치(`feat/evening-digest-diet`, PR #725) 위에 쌓는다. D′는 오케스트레이터 배치를 바꾸므로 ⓒ(`autopilot.orchestrator.ts`, `evening-retro-publish.autopilot-task.ts`)가 머지된 뒤에 한다.
2. ⓒ는 판정 댓글을 저녁 회고 첫 스레드로 올린다. D′에서 업무 회고 요약이 스레드에 추가될 때도 그 순서를 지켜야 한다.
3. 메인 형식이 바뀐 날을 판정 버튼 누름률 관측의 기산일로 둔다. 피드백 설계 §7 표에는 기산일 칸이 없으므로 그 표에 행을 추가한다.

## 8. 성공 기준

각 기준은 단일 회차가 아니라 **5영업일 연속**으로 본다. LLM 출력은 회차마다 다르다.

- **메인 중복**: 사실(PR 건수, 검증 공백, 외부 대기 PR)마다 메인 등장 횟수를 사람이 센다. 의역도 같은 사실로 센다. 기준은 각 1회다. 사실이 **아예 빠진 날**은 실패로 친다. 누락은 중복 해소가 아니다.
- **메인 길이**: `logs/slack-send.jsonl`의 저녁 메인 `chars`를 본다. 기준선은 1,042~1,823자(10-01은 1,823자)다. 스레드로 옮긴 만큼 스레드 길이가 늘어나는지도 함께 본다.
- **원장 불변**: F는 PO_EVAL·WORK_REVIEWER·EVENING_RETRO output 스키마 diff가 없어야 한다(spec으로 확인).
- **판정 관측**: 새 기산일부터 10영업일 동안 누름률 30% 이상(피드백 설계 §7 기준 그대로)이어야 한다. 미달하면 그 문서의 실패 시 조치를 따른다.
- (D′ 착수 시) 정리 단계 실패 회차에도 KPT·후보·카드는 정상 발송된다(spec). 정리에 입력 원장에 없는 숫자가 들어간 날은 실패로 센다.

## 9. 확인하지 못한 것

- **10-01 원장 본문**: 「오늘 한 일」 본문과 KPT 「문제」·「미완」이 서로 같은 사실을 담는지 확인하지 못했다. F의 기대 효과(각 1회)는 섹션 구조로 판단한 것이고 본문으로는 확인하지 않았다. 확인하려면 해당 회차 `agent_run.output` SELECT가 필요하다.
- 판정 버튼 지금까지의 누름률. #721이 2026-10-01 16:03에 머지됐으므로 표본은 많아야 1회차다.
- D′의 「KPT에 있는 사실은 되풀이하지 않는다」 규칙이 회차마다 지켜지는지. 실측이 필요하다.

## 10. 확정된 결정 (2026-10-02)

1. **F만 진행한다.** 메인이 「오늘 한 일」 + KPT 두 목소리로 남는 것을 받아들인다. D′는 보류하고, F 적용 뒤 메인 중복이 남는 것이 §8 기준으로 확인될 때 다시 연다.
2. **KPT 「문제」 칸 존폐 판정이 먼저다.** 결정 4(관측 재시작 허용)는 누름률 관측에만 해당한다. 저녁 회고 프롬프트를 바꾸는 안(B·C)은 KPT 설계 §3-2 판정이 내려진 뒤에 다시 검토한다.
