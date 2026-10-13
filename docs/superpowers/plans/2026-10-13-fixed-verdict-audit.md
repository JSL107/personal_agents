# FIXED 카드 판정 신뢰도 — 25건 손 검증 (2026-10-13)

> **결론: 표본 25건 중 24건이 「맞게 고쳐짐」, 1건이 요구 일부 누락으로 「다른 걸 고침」이었다.
> 다만 층화 표본이라 모집단 정밀도의 95% 하한은 가정 없이 약 67%, 층 간 오류율이 같다고 가정해야
> 약 80% 까지만 말할 수 있다. 그래서 FIXED 를 정탐 학습 재료로 쓰는 것은 **조건부**로 판정한다** —
> 표본이 가장 얇은 personal_agents 층(108건 중 8건)을 더 뽑아 하한을 올린 뒤에 쓴다(§5).
> 판정기가 지적한 파일의 diff 만 보는 탓에, 수정이 다른 파일로 옮겨 가면 코드 대신 주석이 판정 근거가
> 되는 사각지대도 있다(아래 「관찰」 ①).

배경은 스펙 `docs/superpowers/specs/2026-09-08-pr-review-depth-and-learning-design.md` §4 「4단계 ⓑ」와
`tasks/goals-pr-review-loop.md` 「목표 밖」의 같은 항목이다. 두 문서 모두 FIXED 로 정탐을 학습하기
전에 표본 20건을 손으로 검증하라고 요구한다. 이 문서는 그 선행 조건의 결과다. 코드는 바꾸지 않았다.

---

## 1. FIXED 는 어떻게 찍히는가

FIXED 를 쓰는 경로는 하나뿐이다(`src/pr-review-loop/application/harvest-review-signals.usecase.ts:516-529`).

1. 반응(👍·👎·답글)이 없는 카드 가운데 **열린 PR 의 인라인 카드**만 후보가 된다(같은 파일 `:437-450`).
2. 카드 게시 시점 커밋(`head_sha`)과 **판정 시점의 PR head** 를 비교하고, 지적한 줄 근처가 실제로
   바뀌었는지 먼저 계산으로 거른다(`collectResolutionCandidates`, `:535-611`). 안 겹치면 모델을 부르지 않는다.
3. 남은 카드에 대해 **그 카드가 가리킨 파일의 diff 만** 잘라(`extractFileDiff`) 모델에 묻는다
   (`src/agent/review-reply-judge/domain/prompt/finding-resolution.prompt.ts`).
   답은 FIXED / NOT_FIXED / UNCLEAR 셋 중 하나이고, FIXED 일 때만 카드를 닫는다.

그래서 이 검증이 재는 것은 **FIXED 의 정밀도**(FIXED 라고 한 것 중 실제로 고친 비율)다.
고쳤는데 NOT_FIXED·UNCLEAR 로 남은 카드(재현율)는 범위 밖이다.

## 2. 표본과 방법

**모집단**: `pr_review_finding` 의 `status='FIXED'` 180건(6레포, 2026-08-04 ~ 10-12 판정).

| 레포 | FIXED | 표본 |
|---|---:|---:|
| JSL107/personal_agents | 108 | 8 |
| schoolbell-e/sbe-api-v5 | 23 | 5 |
| schoolbell-e/sbe-spinoff-workspace | 23 | 5 |
| schoolbell-e/sbe-api-v5-puppeteer | 12 | 2 |
| DDD-Community/DDD_BE | 8 | 3 |
| schoolbell-e/sbe-api-v4 | 6 | 2 |
| **합계** | **180** | **25** |

**뽑는 법**: 레포 × 카테고리 23칸에서 칸마다 1건, 그리고 비중이 가장 큰 personal_agents
CORRECTNESS(55건)에서 2건을 더 뽑았다. 칸 안의 순서는 `md5(id || 'fixed-audit')` 로 정해 누가 다시
뽑아도 같은 표본이 나온다. 카테고리 6종(CORRECTNESS 8 · RELIABILITY 5 · SECURITY 4 · TEST 4 ·
READABILITY 3 · ARCHITECTURE 1)이 모두 들어갔고, FIXED 를 가진 레포 6개도 모두 들어갔다.

**판정 시점 head 복원**: 원장은 판정 시점의 PR head 를 저장하지 않는다. 그래서 PR 커밋 중
committer 시각이 `decided_at` 이전인 마지막 커밋을 판정 시점 head 로 잡았다. 25건 모두 카드 이후,
판정 이전에 커밋이 하나 이상 있었고, 카드의 `head_sha` 가 PR 커밋 목록에서 사라진 경우(강제 푸시)는
없었다.

**대조**: 건마다 ① 지적 본문, ② 카드 시점 파일의 지적 줄 ±12줄, ③ `head_sha...판정 시점 head`
비교 diff 를 GitHub API 로 받아 읽었다. 필요하면 같은 비교의 다른 파일과 판정 이후 커밋까지 열었다(642·344).

**분류 기준**
- **맞게 고쳐짐** — 지적이 요구한 변경이 판정 시점 head 에 들어 있다.
- **다른 걸 고침** — 그 줄 근처가 바뀌었지만 지적과 무관하거나, 지적이 요구한 것이 **일부라도** 빠졌다.
  빠진 항목이 사소해 보여도 여기로 센다 — 판정기 프롬프트의 FIXED 정의가 「그 지적을 실제로 해소했다」이기 때문이다.
- **판정 불가** — 주어진 근거로 어느 쪽인지 정할 수 없다.

## 3. 결과

| 분류 | 건수 |
|---|---:|
| 맞게 고쳐짐 | **24** |
| 다른 걸 고침 | 1 (748, 요구 일부 누락) |
| 판정 불가 | 0 |

표본 정밀도는 24/25(96%)다. 모집단 180건에 대한 하한은 **표본 설계를 반영해** 계산해야 한다.
층마다 1건(personal_agents CORRECTNESS 만 3건)을 뽑았으므로 카드마다 뽑힐 확률이 다르다 —
personal_agents 는 108건 중 8건(7%)을 봤지만 DDD_BE 는 8건 중 3건(38%)을 봤다. 25건을 같은 확률의
독립 표본으로 보는 단순 이항 하한은 이 차이를 무시하므로 쓰지 않는다.

| 하한 계산 | 가정 | 95% 하한 |
|---|---|---:|
| 설계 기반 최악 배치 | 없음. 층별 비복원 추출(초기하분포)을 그대로 쓰고, 오류가 표본이 얇은 층에 가장 불리하게 몰려 있다고 놓는다 | **67.2%** (오류 최대 59/180) |
| 균일 오류율 | 모든 층의 오류율이 같다 | 79.6% (Clopper-Pearson, 24/25) |

설계 기반 하한은 「표본 오류 합이 1건 이하일 확률이 5% 이상 남는」 층별 오류 배치 가운데 총오류가
가장 큰 것을 동적 계획법으로 찾아 구했다. 그 배치에서는 오류가 거의 전부 personal_agents 층에 몰린다.
참고로 748 을 맞게 고쳐짐으로 셌다면(오류 0건) 같은 방법의 하한은 77.8% 다. 모집단은 감사 시점
(`decided_at` ≤ 2026-10-12 03:09) 기준 180건이며, 이후 FIXED 가 2건 더 쌓였다.

### 건별 표

판정 시점 head 는 위 방법으로 추정한 커밋이다. 근거의 `파일:줄` 은 카드가 가리킨 위치다.

| 카드 | 레포#PR | 분류 | 지적 요지 | 판정 시점 head | 근거 | 판정 |
|---|---|---|---|---|---|---|
| 1141 | DDD_BE#102 | CORRECTNESS | 확인 안 된 모집일로 기수를 운영 DB 에 만든다 | `edde929` | `scripts/fix-cohort-mapping.sql:24` — 10기 INSERT 를 지우고, 기수가 없으면 중단하도록 바꿈 | 맞게 고쳐짐 |
| 642 | DDD_BE#87 | RELIABILITY | 자격 확인과 예약 트랜잭션 사이 TOCTOU | `ca99df6` | `public.interview-booking.controller.ts:80` 에서 검사를 빼고, 같은 커밋이 `interview.service.ts` 의 예약 트랜잭션 안으로 서류합격 검사를 옮김 + 동시성 통합 테스트(`test/interview-booking-concurrency.int-spec.ts`) 추가 | 맞게 고쳐짐 ※관찰 ① |
| 309 | DDD_BE#85 | SECURITY | 6자리 인증번호를 평문 SHA-256 으로 저장 | `47cbbff` | `application-verification.service.ts:124` — `createHmac('sha256', 용도 분리 키)` 로 교체 | 맞게 고쳐짐 |
| 1234 | personal_agents#644 | ARCHITECTURE | humanize 가 review-reply-judge 내부의 쿼터 판별에 의존 | `703bac1` | `humanize.service.ts:4` — import 를 `model-router/application/extract-codex-quota` 로 옮김 | 맞게 고쳐짐 |
| 450 | personal_agents#384 | CORRECTNESS | 40건으로 자른 뒤 목소리를 걸러 개인 글 표본이 빈다 | `9f80d3a` | `humanize.service.ts:38` — 목소리 조건을 조회(`inputSnapshotEquals`)로 내리고 `limit` 을 표본 수로 바꿈 | 맞게 고쳐짐 |
| 476 | personal_agents#399 | CORRECTNESS | 링크 변환이 코드 블록·인라인 코드 안까지 바꾼다 | `2ee98d7` | `mrkdwn.util.ts:37` — 펜스 안은 건너뛰고 인라인 코드를 보호 토큰에 추가 | 맞게 고쳐짐 |
| 70 | personal_agents#230 | CORRECTNESS | 통지를 보낸 창 대신 `NSApp.windows.first` 로 판정 | `61a05fa` | `OfficeView.swift:180` — `notification.object` 창을 우선 쓰고 시트는 제외 | 맞게 고쳐짐 |
| 1011 | personal_agents#595 | READABILITY | 계산 코드 세 자리가 공존한다는 사실과 정본이 문서에 없다 | `3f3045e` | 스펙 §6 에 「계산 코드는 세 자리에 있다 … 기준값의 정본은 세 번째다」 추가 | 맞게 고쳐짐 |
| 300 | personal_agents#320 | RELIABILITY | 비공개 초안을 공개 경로로 재조회하고 slug 비교도 안 한다 | `16944bf` | `publish-portfolio-site.usecase.ts:79` — 인증 경로 `listProjects()` 로 재조회해 기대 slug 와 대조(`verifyPublished`) | 맞게 고쳐짐 |
| 323 | personal_agents#331 | SECURITY | 원제목이 마스킹 없이 미리보기에 실린다 | `8bcd67c` | `publish-notion-draft.usecase.ts:458` — `maskForbidden(draft.title, …)` 적용 | 맞게 고쳐짐 |
| 398 | personal_agents#352 | TEST | `slackUserId: ''` 분기 테스트가 없다 | `be86794` | `agent-run.prisma.repository.spec.ts:88` 근처에 빈 문자열 JSON 경로 매칭 테스트 추가 | 맞게 고쳐짐 |
| 702 | sbe-api-v4#281 | CORRECTNESS | `date("Y") + 1` 로 1~2월에도 다음 해 기준일이 된다 | `62d2e1f` | `CloudStorage.php:91` — 3월 전이면 올해, 이후면 내년으로 학년도를 가름 + 테스트 | 맞게 고쳐짐 |
| 158 | sbe-api-v4#261 | TEST | 롤백 테스트가 비엄격 sql_mode 에 좌우된다 | `e6d9c66` | `CurrentCreditDeltaTest.php:143` — 세션에서 `STRICT_ALL_TABLES` 를 켜고 `finally` 에서 복원 | 맞게 고쳐짐 |
| 301 | sbe-api-v5#990 | CORRECTNESS | 가구 키가 멤버 타입을 보지 않아 비보호자가 합쳐진다 | `8405ed3` | `LetterPostModel.ts:132` — 보호자(Parent1·2)일 때만 `student_member_id` 사용 | 맞게 고쳐짐 |
| 383 | sbe-api-v5#1011 | READABILITY | 주석이 바뀐 mock 스키마(DEFAULT NULL)와 어긋난다 | `ad07690` | `DeviceController.spec.ts:136` — 주석을 「이 PR 이전의 mock 은 … 같은 PR 에서 맞췄다」로 정정 | 맞게 고쳐짐 |
| 344 | sbe-api-v5#1006 | RELIABILITY | 조회로 읽은 placement 와 UPDATE 사이 TOCTOU | `466d3c6` | `StaffBannerController.ts:157` — 조회로 placement 를 알아낸 경우 UPDATE 조건에 그 값을 고정(CAS) | 맞게 고쳐짐 ※관찰 ② |
| 748 | sbe-api-v5#1081 | SECURITY | 활성 uid·이름·실제 device_token 이 남아 있다 | `4e71875` | `call-ios.ts:12` 근처 — uid 를 더미(`0:100001`)로, token 을 `TEST_APNS_TOKEN` 환경변수로 교체했으나 이름(`김교사`)은 남김 | 다른 걸 고침 ※관찰 ③ |
| 339 | sbe-api-v5#1005 | TEST | priority 0 행을 priority 없이 로고로 전환하는 테스트가 없다 | `7bf5ecd` | `StaffBannerController.spec.ts:217` 근처 — 「priority 0 인 행을 … 전환하면 400」 테스트 추가 | 맞게 고쳐짐 |
| 524 | sbe-api-v5-puppeteer#121 | CORRECTNESS | 경고창 내용을 안 보고 모두 비공개로 분류 | `c313d9a` | `unreadable-row.fn.ts:50` — `/비공개\|비밀\s*글/` 문구일 때만 잠김, 삭제는 404·410 만 | 맞게 고쳐짐 |
| 513 | sbe-api-v5-puppeteer#117 | RELIABILITY | 마지막 팝업만 닫아 중간 팝업이 남는다 | `fb64019` | `Crawl.ts:188` — 사전 액션이 연 팝업을 모두 모아 `closePopupPages` 로 닫음 | 맞게 고쳐짐 |
| 1183 | sbe-spinoff-workspace#2917 | CORRECTNESS | 14a·14a-2 설명이 「staging 배포 완료」와 양립하지 않는다 | `8a7fd05` | 로드맵 `:87-88` — 「적용하면 부팅에 실패한다」·「로더 코드가 없다」를 배포 완료·로더 위치 서술로 교체 | 맞게 고쳐짐 |
| 942 | sbe-spinoff-workspace#2830 | READABILITY | 후속 범위인 OIDC·GCS 패키지가 런타임 의존성에 있다 | `16baeee` | `api/package.json:14` — `oidc-rp-bff`·`@google-cloud/storage` 등 6개 제거 | 맞게 고쳐짐 |
| 1184 | sbe-spinoff-workspace#2921 | RELIABILITY | 대상·제외자 해석 예외가 실패 계약을 우회한다 | `5c66f62` | `conduct-notifications.service.ts:64` — 대상 해석을 `try` 로 감싸 실패를 결과로 반환, 제외자 조회는 `excludeUserIds` 직접 전달로 없앰 | 맞게 고쳐짐 |
| 1587 | sbe-spinoff-workspace#3922 | SECURITY | COMMIT 실패 시 업로드된 CSV 가 남는다 | `0c0b267` | `exports.service.ts:99` — 트랜잭션·업로드를 정리 `try` 안으로 옮겨 어느 단계 실패든 삭제 | 맞게 고쳐짐 |
| 1505 | sbe-spinoff-workspace#3754 | TEST | REDUCTION·CANCEL·CORRECT·SCOPE_MISSING 이 테스트되지 않는다 | `be8d924` | `migration-constraints.integration.spec.ts:434` 근처 — 종류 5개·결과 4개 `it.each` 추가 | 맞게 고쳐짐 |

## 4. 관찰

**① 판정기는 지적한 파일의 diff 만 본다 — 수정이 다른 파일로 옮겨 가면 주석이 근거가 된다 (642).**
642 의 수정은 컨트롤러의 자격 검사를 **지우고** 서비스의 트랜잭션 안으로 옮긴 것이다. 판정기에
들어간 것은 컨트롤러 diff 뿐이라, 모델이 본 것은 「검사가 사라졌다」와 「자격 검증은 예약 트랜잭션
안에서 수행된다」는 새 주석이었다. 결론은 맞았지만 근거는 코드가 아니라 작성자의 주장이었다.
같은 구조에서 주석만 달고 실제로 옮기지 않았다면 FIXED 가 됐을 수 있다. 시스템 프롬프트가 diff 속
문구를 의심 신호로 다루라고 하지만, 이 경우는 지시문이 아니라 설명문이라 그 경고에 걸리지 않는다.
표본 25건 중 이런 이동형 수정은 642 한 건이었다.

**② 카드가 짚은 경로는 고쳤지만, 같은 커밋이 옆 경로에 같은 모양의 창을 남겼다 (344).**
지적은 「placement 를 조회로 알아낸 경우」의 TOCTOU 였고(카드 줄 157 이 그 분기 안이다), 판정 시점
커밋이 그 경우에 CAS 조건을 걸었다. 그런데 같은 커밋이 placement 를 명시한 요청에도 기존 행을 조회해
검증하게 바꾸면서 그쪽에는 조건을 걸지 않았다. 이 창은 다음 날 `ef065e9` 「동시성 창」에서 닫혔다.
지적 자체에 대해서는 맞게 고쳐진 것으로 분류했다.

**③ 지적이 든 세 항목 중 하나가 남았다 (748).**
지적은 uid·이름(`김교사`)·device_token 셋을 들었다. 판정 시점 커밋은 uid 와 token 을 치웠고 `김교사` 는
남겼다. 직함 형태의 자리표시라 보안상 실질 위험은 작아 보이지만, 지적이 이름 제거를 명시적으로 요구했으므로
분류 기준대로 「다른 걸 고침」으로 셌다. 판정기는 핵심 항목이 고쳐지면 일부 누락을 FIXED 로 넘기는 경향이
있다는 신호로 읽는다.

**④ FIXED 카드는 대부분 「리뷰 반영」 커밋으로 빠르게 닫힌다.**
25건 중 13건은 커밋 메시지에 리뷰 반영을 직접 적었고, 나머지도 지적을 겨냥한 단일 목적 커밋이었다.
카드 게시부터 판정까지는 대부분 수십 분 안이었다(최장 642 의 약 23시간). 정밀도가 높게 나온 데는
판정기 성능만이 아니라 이 운영 습관 — 지적을 받으면 그 줄을 겨냥한 커밋을 바로 올린다 — 이
크게 기여한다. 작성자가 리뷰 반영과 무관한 리팩터링으로 같은 줄을 자주 건드리는 레포가 늘면
이 수치는 그대로 유지된다고 보장할 수 없다.

## 5. 판정 — FIXED 를 학습 재료로 써도 되는가

**조건부.**

- 표본 정밀도는 24/25(96%)로 높지만, 모집단 하한은 가정 없이 67%, 균일 오류율을 가정해도 80% 다.
  FIXED 다섯 건 중 한 건 이상이 틀렸을 가능성을 배제하지 못하는 수준이라 그대로 학습 재료로 쓰기엔 부족하다.
- **조건**: 하한을 깎는 것은 표본이 얇은 personal_agents 층(108건 중 8건)이다. 이 층에서 무작위로 더 뽑아
  같은 설계 기반 계산의 하한이 목표치(예: 90%) 를 넘는지 확인한 뒤에 쓴다.
- 관찰 ③처럼 핵심만 고치고 일부를 남긴 카드도 FIXED 가 된다. 이런 카드를 「완전히 맞은 정탐」으로 학습시키면
  남긴 부분이 기준이 될 수 있으므로, 쓰더라도 지적의 요구 항목이 여럿인 카드는 따로 표시해 둔다.
- 쓰게 되면 스펙이 걸어 둔 조건 — 진행 후 30일 채택률로 유지·철회를 판정한다 — 을 그대로 적용한다.
- 관찰 ①의 사각지대는 학습 재료의 오염 경로로 남는다. 학습을 켠 뒤 주기적으로 다시 볼 때는
  「카드 파일에서 코드가 삭제되고 다른 파일에 옮겨진 것으로 보이는」 FIXED 를 우선 표본으로 삼는다.

우선순위는 별개다. `tasks/goals-pr-review-loop.md` 는 목표 7(사람이 쓴 수용 답글)이 더 나은 재료를
주므로 이 항목이 사실상 대체됐다고 적었다. 이 검증은 「FIXED 가 믿을 만한가」에만 답하며, 지금 열지는
그 판단에 맡긴다.

## 6. 확인하지 못한 것

- **재현율**: 실제로 고쳤는데 NOT_FIXED·UNCLEAR 로 남은 카드가 얼마인지는 재지 않았다.
- **판정 시점 head 는 추정값이다.** committer 시각으로 잡았으므로, 판정 이전에 커밋됐지만 판정 이후에
  푸시된 커밋이 있었다면 판정기가 실제로 본 diff 보다 넓게 보았을 수 있다. 25건 모두 판정 직전 커밋이
  지적을 겨냥한 수정이라 결론이 바뀔 여지는 작다.
- **모델이 남긴 이유(`reason`)는 원장에 저장되지 않아** 모델이 무엇을 근거로 FIXED 를 골랐는지는
  직접 보지 못했다. 관찰 ①은 입력에 들어간 diff 로부터 추론한 것이다.
