# Slack 발송 관문 — 보낼 가치 판정·고장 사건화·읽힘 신호

- 근거: `docs/superpowers/audits/2026-10-07-slack-output-quality-audit.md`
- 범위 밖: 대화형 응답(자연어 해석·`ConversationalReplyUsecase`) — 별도 세션 "[개발] 이대리 대화 응답"

## 사용자 결정 (2026-10-07)

| 질문 | 답 |
|---|---|
| 계속 받을 발송 | 비서실 브리핑 · 오늘의 공부/도구 · 회고·careerLog · 발행 완료 알림 · 모의투자 추천·체결 · 주식 모니터링 경보(새 경보 있을 때만) · 새 공고·갭 분석 · AI/LLM 동향·뉴스 |
| 고장 알림 위치 | DM (지금처럼) |
| 같은 원인 고장의 빈도 | 발생 1회 + 해결 1회, 이어지는 동안 침묵 |

고르지 않은 것 — PR 리뷰 스윕 통계, 좀비/만료 카드 정리, 유니버스 스윕, 스크리닝 사후 채점, "새 경보 없음", AI CLI 환경 스냅샷 등 — 은 Slack 에서 내리고 콘솔·주간 요약으로 옮긴다.

## 코드로 확인한 현재 구조

- 크론 발송은 전부 `SlackService.postChat` (`src/slack/slack.service.ts:270`)를 지난다. `SLACK_NOTIFIER_PORT` 4곳이 모두 `useExisting: SlackService` 다. 직접 `WebClient` 로 보내는 곳은 2곳(`schedule-slack.notifier.ts:60` 일정 등록 확인, `agent/blog/.../slack-web.notifier.ts:39` 블로그 완료 답장)이고, 둘 다 사용자 행동에 대한 응답이다.
- `postMessage` 호출부는 15곳(autopilot 오케스트레이터 7, 그 밖 consumer 8)이고, 이를 쓰는 spec 이 8개 있다.
- **autopilot 은 여러 task 요약을 한 메시지로 합친다.** evening(work-reviewer·daily-eval·evening-retro-publish·blog-github-publish), morning(secretariat·morning-briefing), noon 그룹은 `autopilot.orchestrator.ts:367-369` 에서 요약을 이어 붙여 한 번에 보낸다. 그래서 "메시지 하나 = 종류 하나" 가 성립하지 않는다.
- **오케스트레이터는 메인 메시지 ts 가 없으면 실패로 본다** (`autopilot.orchestrator.ts:590-638`). 상세를 유실로 표시하고 판정 버튼을 건너뛰며, `detailIsOnlyCopy` 상세는 채널로 대피 발송한다. 스레드 이미지는 기록 없이 사라진다.
- 빈 회차 판정은 task 마다 다르다. `skip: true` 를 쓰는 task 도 있고, 일부러 "내용 없음" 안내문을 보내는 task 도 있다(ceo-meta·impact-report·knowledge-lint·weekly-summary·resume-calibration). 안내문을 보내는 의도는 "죽어서 안 온 것" 과 "할 말이 없어서 안 온 것" 을 구분하는 것이다.
- 모든 봇 발송을 기록하는 테이블은 없다. ts 를 저장하는 컬럼은 승인 카드·제안 카드 같은 개별 기능의 좌표뿐이다.

### dedupe 가 설명(30분)과 다르게 동작한 원인

`notification.consumer.ts:18-33` 의 dedupe 는 "같은 키를 30분 안에 다시 보내지 않는다" 는 **속도 제한**이다. 고장이 이어지는지 끝났는지를 모른다.

- 실측(09-16 18:00 ~ 09-18 19:30, claude 인증 경보 22회): 간격 21개 중 20개가 28분 이상(30~117분)이었다. claude 호출이 일어나는 cron 주기마다 30분 창이 이미 지나 있었으니 매번 다시 보냈다. 문구의 "30분 안 동일 사고는 dedupe" 는 사실이지만, 고장이 이틀 가면 이틀 내내 울린다는 뜻이었다.
- 예외 1건(09-18 14:40 → 14:54, 14분): 마지막 발송 시각을 프로세스 메모리 `Map` 에만 둔다. 재시작하면 지워진다. 재시작 시각과의 대조는 아직 하지 못했다.
- "해결" 알림이 없다. 언제 고쳐졌는지는 알림이 멈춘 것으로 추측할 수밖에 없다.
- BullMQ 재시도(cron 큐 `attempts` 2~4회)도 실패 한 번을 여러 번의 알림 요청으로 불린다.

### 이 레포 밖에서 오는 발송

- **아침신문 실패**(`:warning: Cron job '아침신문' failed: ...`)는 이대리와 같은 봇 계정(U0AULUXLF9B)으로 올라오지만 이 레포에는 그 문구가 없다. 별도 프로세스인 Hermes 가 같은 봇 토큰으로 직접 보낸다. 이 레포의 관문으로는 막을 수 없으므로 Hermes 설정 쪽 작업으로 분리한다(이대리의 `hermes-watchdog` 이 이미 같은 고장을 점검하고 있다).

## 설계

### 1. 관문은 오케스트레이터의 "합치기 전" 항목 단위에 둔다

`SlackService` 에 관문을 두면 두 문제가 생긴다. 합쳐진 다이제스트에 종류가 여러 개라 판정 단위가 없고, 안 보낸 메시지는 ts 가 없어서 오케스트레이터가 실패로 보고 대피 발송한다(콘솔로 내렸는데 채널에 다시 올라가는 역설).

그래서 판정을 둘로 나눈다.

- **보낼지 판정 — autopilot 오케스트레이터, 항목 단위.** task 결과를 `items` 에 넣기 직전에 `decideDelivery(taskId, result)` 를 부른다. 콘솔로 보낼 종류이거나 `skip` 이면 항목을 넣지 않고 원장에 `SUPPRESSED` 로 남긴다. 항목이 아예 없으면 기존 "보고 내용 없음" 경로(`:293-299`)를 탄다. 이미 있는 정상 경로라 ts 계약을 건드리지 않는다.
- **기록 — `SlackService.postMessage`.** 입력에 `kind` 를 필수로 추가하고, 보낸 결과를 원장에 `SENT` 로 남긴다. 억제는 하지 않는다. autopilot 이 아닌 발송자(study-brief·resume-calibration·job-application-nudge·webhook 2종)는 모두 사용자가 받겠다고 고른 종류라 억제할 대상이 없다.

### 2. 정책표 — 새 발송이 정책 없이 생길 수 없게

`src/autopilot/domain/delivery-policy.ts` (순수 TS):

```ts
export const DELIVERY_POLICY: Record<AutopilotTaskId, DeliveryRoute> = {
  secretariat: 'slack',
  'pr-review-sweep': 'console', // 채택률 통계 — Slack 에서 내림
  'universe-sweep': 'console',
  // ... 37개 전부
};
```

- `AutopilotTaskId` 가 playbook 의 `taskId` 유니온이면 빠진 task 가 있을 때 컴파일이 안 된다. 유니온으로 뽑기 어려우면 playbook 무결성 검사(`autopilot.playbook.ts:565` 이후)에 "모든 taskId 가 정책표에 있다" 를 추가해 부팅·테스트에서 끊는다.
- 다른 발송자의 `kind` 는 `SlackService.postMessage` 의 필수 인자라, 새 발송을 추가하면 종류를 밝히지 않을 수 없다. 합쳐진 다이제스트는 `kind = digest:<groupKey>` 로 기록하고 들어간 task 목록을 함께 남긴다.
- 콘솔로 보낼 목록(2026-10-07 사용자 확정, 13개): `pr-review-sweep`, `run-sweeper`, `preview-sweeper`, `universe-sweep`, `screening-outcome-scoring`, `stock-alert-scoring`, `screening-scorecard`, `ai-cli-env-snapshot`, `memory-vacuum`, `holiday-sync`, `ops-supervisor`, `docs-sync-audit`, `run-retro`. `paper-score`(모의투자 장마감 평가)는 Slack 에 남긴다.
- 콘솔로 보낸 기록을 볼 화면은 이번 범위 밖이다. 화면이 생기기 전까지는 원장과 주간 요약 한 줄(§6)로만 확인한다.
- **승인 카드는 이 정책을 타지 않는다.** 카드는 `postPreviewMessage` 라는 별도 경로이고, 대답해야 진행되는 흐름이다. 위 목록 중 카드를 내는 것은 `docs-sync-audit` 하나인데, 요약을 콘솔로 내려도 그 카드는 계속 Slack 으로 나간다.

### 3. 빈 데이터 — 발송자가 `skip` 하고, 생존 신고는 원장이 맡는다

- 내용이 없으면 안내문 대신 `skip` 을 돌려준다. 오케스트레이터는 이를 원장에 `SUPPRESSED / EMPTY` 로 남긴다. "할 말이 없어서 안 온 것" 이 원장과 콘솔에 남으므로 생존 신고를 Slack 에 보낼 이유가 없어진다.
- 이번에 고칠 발송자: 주식 모니터링 "새 경보 없음"(stock-monitor·stock-monitor-us), careerLog 머지 PR 0건, AI/LLM 동향 유효 기사 0건, resume-calibration `NO_EVIDENCE` 안내문, impact-report PR 0건, knowledge-lint 0건, weekly-summary·ceo-meta 의 빈 회차.

### 본문 반복 억제는 넣지 않는다

처음 안은 "직전과 같은 본문(날짜·시각만 지우고 비교)이면 미발송" 이었다. 실데이터로 시뮬레이션해 보니 걸리는 양이 적었다.

| 계열 | 연속 발송 쌍 | 억제됨 | 다른 부분 |
|---|---|---|---|
| 주식 모니터링(미국) | 34 | 7 (21%) | 근접 종목 줄 유무 |
| 주식 모니터링(국내) | 33 | 1 (3%) | 현재가·평가손 |
| 좀비/만료 카드 정리 | 26 | 2 (8%) | 건수·종류 |
| 스크리닝 사후 채점 | 24 | 10 (42%) | 건수 |
| 유니버스 스윕 | 52 | 4 (8%) | 봉 수·종목 수 |
| PR 리뷰 스윕 | 286 | 0 | PR 번호 |
| README 드리프트 | 4 | 0 | 줄바꿈 표현 |

억제되는 계열은 모두 콘솔로 내리거나(§2) 빈 회차 `skip`(§3)으로 이미 처리된다. 나머지는 숫자가 매번 달라 걸리지 않는다. 남는 효과가 거의 없어서 넣지 않는다. README 드리프트 지적 반복은 발송자 쪽에서 "이미 지적한 항목" 을 기억해야 풀리는 문제라 후속으로 둔다.

### 4. 고장은 "사건" 으로 — 발생 1회 + 해결 1회

새 테이블 `AlertIncident` (`key` unique, `openedAt`, `lastSeenAt`, `occurrences`, `lastError`, `causes`, `resolvedAt`, `resolution`):

- **실패 신고** → 열린 사건이 없으면 만들고 DM "발생" 1회. 있으면 `occurrences`·`lastSeenAt`·`lastError` 만 갱신하고 침묵한다. BullMQ 재시도로 같은 실패가 여러 번 들어와도 여기서 흡수된다.
- **성공 신고** → 열린 사건을 닫고 DM "해결 — N시간 지속, M회 발생, 본 원인: …" 1회.
- **자동 종료** → 24시간 동안 재발이 없으면 닫고 DM "24시간 재발 없음 — 닫음(해결 확인은 아님)". claude 처럼 성공 신호가 거의 오지 않는 사건이 영원히 열려 있지 않게 하는 장치다.
- DB 에 두므로 재시작해도 유지된다. `shouldFireAlert`·`DEDUPE_WINDOW_MS`·메모리 `Map` 은 제거한다.

사건 키와 해결 신호:

| 키 | 실패 신고 | 해결 신호 | 비고 |
|---|---|---|---|
| `cron:Study Brief Cron` 등 3종 | 기존 consumer catch | 같은 consumer 정상 종료 | 키가 1:1 이라 그대로 쓴다 |
| `cron:Autopilot:<group>` | 기존 `autopilot.consumer.ts:104` (그룹 전멸) | 그룹 정상 종료 | |
| `task:<taskId>` | 오케스트레이터 task catch(`:246-258`) | 같은 task 의 다음 정상 반환(`skip` 포함) | 신규 계측. `#공부` 다이제스트에 섞여 가던 "⚠️ <task> 자동 생성 실패"(9월 이후 17건)를 채널에서 빼고 DM 으로 |
| `hermes:<jobName>` | watchdog 이 찾은 job 별 이슈 | 그 job 의 이슈가 사라진 점검 회차 | 지금은 `'Hermes 외부 cron'` 하나로 모든 job 을 묶는다. job 단위로 나눈다 |
| `claude-auth` | 기존 `model-router.usecase.ts:340` | claude 호출 성공(fallback 성공 분기) + 24시간 자동 종료 | claude 는 codex 가 실패할 때만 불리므로 성공 신호가 드물다 |

토스 일봉 404 반복(`#투자` "시세 수집 실패")은 고장 알림이 아니라 universe-sweep 다이제스트의 상세 블록이다(`price-collection-failure.formatter.ts`). universe-sweep 이 콘솔로 내려가면 Slack 에서는 함께 사라진다. 같은 종목이 계속 404 를 내는 것 자체는 데이터 문제라 이번 범위 밖이다.

### 5. 읽혔나·쓸모 있었나 — 최소 신호

새 테이블 `SlackDelivery` (원장): `kind`, `itemKinds`(다이제스트에 들어간 task), `target`, `channelId`, `messageTs`, `status`(`SENT`·`SUPPRESSED`·`FAILED`), `suppressReason`(`CONSOLE_ROUTE`·`EMPTY`), `textPreview`(200자), `reactionCount`, `replyCount`, `createdAt`.

- **반응**: 지금 반응 처리기 3개가 이모지 이름으로 나눠 받고 있다. 이모지 종류와 상관없이 `(channelId, messageTs)` 로 원장 행을 찾아 `reactionCount` 를 올리는 처리기를 하나 더 둔다. 같은 방식으로 이미 3개가 공존하고 있어 충돌은 없다.
- **답글**: 멘션 답글(`router-message.handler.ts:86-90` 가 스레드 ts 를 안다)과 DM 답글만 셀 수 있다. 채널 스레드의 일반 답글은 지금 앱이 받지 않는다 — `message` 이벤트 처리기가 DM 만 본다(`router-message.handler.ts:108-110`). 이것까지 세려면 Slack 앱 설정에서 `message.channels`·`message.groups` 이벤트 구독을 추가해야 한다(사용자 작업). 이번에는 멘션·DM 답글만 센다.
- **클릭은 재지 않는다.** Slack 은 링크 클릭을 알려 주지 않는다.
- **한계**: 합쳐진 다이제스트의 반응은 메시지 단위로만 셀 수 있다. 비서실 브리핑에 반응이 달려도 그것이 morning-briefing 쪽을 향한 것인지는 구분되지 않는다.
- **콘솔 API**: 기존 `src/console/interface/console.controller.ts` (`v1/console`)에 `GET /v1/console/deliveries/summary?days=14`(종류별 발송·억제·반응·답글 수)와 `GET /v1/console/deliveries?status=SUPPRESSED`(콘솔로 돌린 본문)를 추가한다. 콘솔 앱 화면은 범위 밖이고 API 만 만든다.
- **효과 판정 기준**: 적용 후 2주 동안 Slack 발송 일평균(9월 약 36건)과 종류별 반응·답글률을 본다. 반응 0 이 이어지는 종류는 다음 정리 후보로 삼되, 반응이 없다고 안 읽었다는 증거는 아니라는 점을 기준 문서에 함께 적는다.

### 6. 자기평가 통계·내부 정리 로그

- 정책표에서 `console` 로 내리는 것으로 끝난다(§2). 따로 옮기는 작업은 없다.
- weekly-summary 에 "이번 주 콘솔로 돌린 발송 N건(상위 종류 3개)" 한 줄을 붙인다. 주 1회만 Slack 에 그 존재를 알린다.

## PR 나누기

| PR | 내용 | 동작 변화 |
|---|---|---|
| 1 | `SlackDelivery` 원장 + `postMessage` 의 `kind` 필수화 + 정책표 + 오케스트레이터 항목 단위 판정 + 감사 문서 | 콘솔 종류 13개 Slack 미발송 |
| 2 | `AlertIncident` + 사건 키·해결 신호(§4 표) + task 실패의 사건화 + Hermes job 단위 분리 | 고장 DM 이 사건당 2회로, `#공부` 의 실패 항목 제거 |
| 3 | 빈 데이터 발송자 수정(§3 목록) | 빈 회차 Slack 미발송, 원장에 `EMPTY` |
| 4 | 반응·답글 집계 + 콘솔 API + weekly-summary 한 줄 | 신규 API |

각 PR 은 `pnpm lint:check && pnpm test && pnpm build` 3중 green 을 통과해야 한다. 스키마를 바꾸는 PR 은 `pnpm db:push` 후 `pnpm prisma:generate`. 새 테이블 추가뿐이라 파괴적 변경은 없다.

## 리스크

- 정책표 분류가 틀리면 받고 싶은 메시지가 Slack 에서 사라진다. 원장과 콘솔 API 에 본문 미리보기가 남으므로 유실은 아니다. 콘솔 목록은 2026-10-07 사용자가 확정했다.
- 원장 기록 실패가 발송을 막으면 안 된다. 기록은 발송 뒤에 하고 실패는 경고 로그만 남긴다.
- 24시간 자동 종료가 "해결" 로 오독될 수 있다. 문구에 "해결 확인은 아님" 을 명시한다.
- `postMessage` 시그니처 변경으로 spec 8개를 함께 고쳐야 한다.

## 범위 밖 · 후속

- Hermes 의 아침신문 실패 직접 발송 — Hermes 설정에서 끄거나 이대리 watchdog 으로 일원화(별도 레포).
- 채널 스레드 일반 답글 집계 — Slack 앱 이벤트 구독 추가 후.
- 형식 결함은 발송자별 수정이다: 비서실 브리핑 enum 노출, `#공고` `&gt;` 미복원(18/62), 줄바꿈 소실, 3,000자 절단, `#투자` 추천·상세 분할, `#공고` 같은 공고 재등장, README 드리프트 지적 반복.
