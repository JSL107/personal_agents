# 오피스 게이미피케이션 2·3회차 처분 결정

결정 2026-10-08. `2026-08-20-office-gamification-roadmap.md` 의 남은 항목과 `2026-09-04-office-pixel-refit.md` Task 7 을
9/9 코지 리디자인(`specs/2026-09-09-office-cozy-miniature-redesign-design.md`) 이후의 화면 체계에 맞춰 정리한다.
이 문서가 위 두 계획의 잔여 판정을 대체한다. 근거 문서 셋(로드맵·코지 스펙·pixel-refit 계획)은 이 문서와 함께 저장소에 추적된다.

## 1. 코드로 다시 확인한 현재 상태

결정 전에 조사 결과를 코드와 대조했다. 두 항목이 조사 결과와 달랐다.

| 항목 | 상태 | 근거 |
|---|---|---|
| 1회차(이력·성적) | **백엔드만 완료, 화면 없음** | #344 는 `src/` 만 바꿨다. `GET /v1/console/ledger` 를 부르는 코드가 `clients/` 전체에 없다(`ConsoleClient.swift` 의 조회는 snapshot·briefing·activity·schedules·stream 뿐) |
| 2회차 서류 주고받기 | **동작 중** | `OfficeChoreography.swift` 가 `parentId`(없으면 `participants`)로 넘긴 사람을 찾아 `.handoff` 를 내고, `OfficeScene.handoff` 가 받는 사람 책상까지 걸어갔다 돌아온다. 코드는 #167 부터 있었으나 시작 알림의 `parentId` 가 늘 비어 있어 발동하지 않았고, #715 가 이를 고쳤다. 3D 는 #699, 웹은 `live.js` `handoff()` |
| 2회차 잡담 | 완료 | #478, 웹 #706 |
| 2회차 창밖 날씨 | 없음 | 시간대 창빛(`OfficeDaylight`)만 있다 |
| 2회차 옆자리 리액션 | 없음 | 해당 코드 없음 |
| 3회차 조작 | 없음 | `ConsoleTodo` 는 `kind·label·detail` 만 싣고 실행용 id 가 없다. 콘솔 쓰기 API 는 `command`·`approvals/:id/apply|cancel`·`sessions/:id/inject` 뿐이다. 「회의실 벽면 판」은 대표 머리 위 할 일 말풍선(`renderPresidentTodoBubble`)으로 바뀌어 클릭할 판이 없다 |
| 웹 렌더러 따라잡기 | 없음 | `office-web` 에 briefing·streak·ledger 소비 코드가 없다. 맥의 「3D 오피스」(#692)가 이 웹 렌더러를 쓰므로 격차가 맥에서도 보인다 |
| pixel-refit Task 7 | 없음 | `raw/pack-*`·`Resources-LICENSE.md` 없음 |

## 2. 결정

| 항목 | 처분 | 근거 |
|---|---|---|
| 1회차 ① 이력 두 줄 | **형태를 바꿔 유효** — 커서 쪽지 대신 `AgentInspectorView` | 코지 스펙 §5.1 이 직원 상세를 오른쪽 인스펙터로 정했다 |
| 1회차 ② 자율 워커 정지 | **형태를 바꿔 유효** — 채도 대신 대시보드 「사람 손 필요」 목록 + 캐릭터 배지 | 코지 체계는 상태를 표정·배지로 표현한다(§4.4). #735 대시보드가 이미 주의가 필요한 담당자를 모아 보여 준다 |
| 1회차 ③ 회사 성적 한 줄 | **폐기** | #735 대시보드의 핵심 숫자·14일 추이가 대체한다 |
| 2회차 서류 주고받기 | **완료로 닫음** | 위 §1. 손에 드는 서류 소품은 추가하지 않는다 — cozy props 에 에셋이 없고, 걷는 동작만으로 전달 의미가 읽힌다 |
| 2회차 창밖 날씨 | **폐기** | 08-19 원 스펙이 "없어도 아쉽지 않다"로 분류했다. 실제 날씨는 외부 API 와 env 4곳 갱신이 필요해 가치 대비 비용이 크다 |
| 2회차 옆자리 리액션 | **폐기** | 잡담·회의·인계가 생동감 목표를 채웠다. 좌석 주변 연출은 이름표 겹침 회귀 위험이 가장 크다 |
| 3회차 조작 | **형태를 바꿔 유효** — 오피스 장면이 아니라 대시보드 「사람 손 필요」 목록·인스펙터에 버튼 | 클릭할 판이 없어졌다. 동작별로 나눈다: **승인**은 인스펙터에 이미 있어 완료. **실패 재시도**는 유효하나, 재실행 로직을 Slack 핸들러에서 공용 유스케이스로 먼저 꺼내야 한다(§3-2). **PR 리뷰 회수**는 지적마다 정탐·오탐 판정이 필요해(`docs/pr-review-bot-protocol.md`) 원클릭 실행이 맞지 않으므로 GitHub PR 을 여는 링크까지만 둔다 |
| 웹 렌더러 따라잡기 | **형태를 바꿔 유효** — 대상은 3D 만 | 1·3회차를 SwiftUI 쪽(대시보드·인스펙터)에 두면 웹으로 옮길 것은 #338 의 할 일 말풍선·연속 도장·정산 종이 셋으로 줄어든다 |
| pixel-refit Task 7 | **폐기** | 코지 스펙 §4.1 이 양자화된 도트 경계를 폐기했다. 2D 는 cozy 원화(`SpriteLoader.cozy*`, 394장)로 그리고 픽셀 스프라이트는 폴백으로만 남아 있다 |

## 3. 남은 작업과 대략적인 비용

착수 순서는 아래 번호 순이다. 1번은 백엔드 API 가 이미 있어 가장 싸고, 1회차의 원래 목적(화면이 감추고 있는 정지를 드러낸다)이 아직 달성되지 않았다.

1. **1회차 화면** — 백엔드 변경 없음. Swift 5~7개: `ConsoleClient` ledger 조회, Core 모델·디코딩 테스트, `AgentInspectorView` 이력 두 줄, 대시보드 「사람 손 필요」 목록에 정지 워커, 캐릭터 배지.
   착수 전 확인: 워커 폐지(#719 등) 이후 ledger 의 정지 판정과 `NEVER_RUN` 분류가 지금 레지스트리와 맞는지.
2. **3회차 재시도·PR 링크** — 두 가지 선행 작업이 있어 백엔드가 7~10개로 늘어난다.
   - **재실행 유스케이스 추출(선행).** `RetryRunUsecase.execute()` 는 FAILED run 의 스냅샷을 돌려줄 뿐 재실행하지 않는다(`src/agent-run/application/retry-run.usecase.ts:64-76`). 입력 검증·소유자 검사·agentType 별 디스패치는 Slack 전용 `RetryRunHandler` 의 switch 에 있다(`src/slack/handler/retry-run.handler.ts:131` 이후). 콘솔에서 이 switch 를 복제하면 두 진입점이 어긋나므로, 전송 계층과 무관한 replay 유스케이스로 꺼내 Slack 과 콘솔이 함께 쓴다. 이 switch 는 16종만 다루고 나머지는 `default` 로 빠지므로, 재시도 버튼은 지원 종류에만 띄운다. 비용: 유스케이스 신설 + 핸들러 이관 + 테스트로 4~5개.
   - **할 일 항목을 대상별로 나눈다.** `buildFailedRunTodo`·`buildReviewTodo` 는 대상이 여럿이어도 「실패한 실행 N건 재시도」·「PR 리뷰 회수 N건」으로 할 일 하나에 합친다(`src/console/application/build-president-briefing.usecase.ts:238-281`). 여기에 `runId`·`url` 하나만 붙이면 N건 중 한 건만 처리된다. 또 `FailedAgentCandidate` 는 `agentType` 만 들고 run id 가 없다. 그래서 할 일 하나에 `targets: { runId | pullNumber, url, label }[]` 배열을 싣고 버튼은 대상마다 그린다. 대표 머리 위 말풍선은 지금처럼 합친 문구를 쓴다. 비용: 브리핑 유스케이스·타입·테스트로 2~3개.
   - 콘솔 API `POST /v1/console/runs/:id/retry`(PreviewGate 경유 여부는 설계 시 결정) 1~2개.
   - Swift 4~5개: `ConsoleTodo` 디코딩·테스트, 클라이언트, 대상 목록 UI.
   착수 전 확인: 로드맵 §3 이 지적한 "승인 카드 만료 경로가 canceller 를 부르지 않는 문제"가 #643 이후에도 남아 있는지(이번 결정 시점에는 확인하지 않았다).
3. **웹 3D 따라잡기** — `live.js`·`three/overlay3d.js` 와 브리핑 전달 경로(웹이 `/v1/console/briefing` 을 직접 조회하거나 `OfficeHosting` 메시지로 넘김). 중간 규모. 웹 2D(Canvas)는 대상에서 뺀다.
   - 후속 처리(2026-10-08): #763 리뷰 지적(웹 브리핑 검사의 기대값이 손으로 고정돼 맥 규칙이 바뀌어도 통과)을 맥·웹 공용 대조표 `clients/idaeri-console/fixtures/president-briefing.json` 로 닫았다. 맥 `ConsoleCoreTests`(`BriefingParityTests.swift`)와 웹 `check:briefing` 이 같은 파일로 양쪽 함수를 잰다.

## 4. 이 결정으로 닫히는 것

- `2026-08-20-office-gamification-roadmap.md` §3 의 2회차 전체, 1회차 ③.
- `2026-09-04-office-pixel-refit.md` Task 7. 같은 계획의 「남는 것」 중 웹 스프라이트 반영도 함께 닫는다(픽셀 스프라이트를 더 진행하지 않으므로).
- 로드맵 §5 「세 회차 모두 안 하는 것」은 그대로 유지한다.
