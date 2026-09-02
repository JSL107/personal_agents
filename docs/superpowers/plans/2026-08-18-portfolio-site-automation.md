# 포트폴리오 사이트(Portfolio OS)와 이대리 연동 설계

> 작성 2026-08-18 · 상태: A·B·C 구현 완료(PR 대기). 실증은 B 배포·토큰 설정 후
>
> **한 줄 요약** — 이대리는 이미 "머지된 PR을 읽어 경력 성과를 합성하고 포트폴리오를 렌더하는" 파이프라인을
> 갖고 있다. 목적지가 노션 페이지 하나뿐이라서, 이번에 만든 포트폴리오 사이트를 **두 번째 목적지로 추가**하는
> 것이 이 연동의 본체다. 새 파이프라인을 짜는 일이 아니다.

---

## 1. 왜 지금인가

포트폴리오 사이트(`Portfolio OS`, 레포 `~/Desktop/backend/기타/portfolio`)가 공개 운영에 들어갔다.
구글 로그인으로 편집하고 `/u/{handle}` 주소로 공개하는 구조이며, 편집 내용을 담는 REST API가 완성돼 있다.

한편 이대리에는 `career-mate` 모듈이 있다. 저녁 회고 때 그날 머지된 PR을 모아
"성과 항목 + 스킬 목록"으로 합성하고(`ReflectPrUsecase`), 그 결과를 노션 페이지에 렌더한다
(`RenderPortfolioUsecase`). 즉 **포트폴리오의 내용을 만드는 쪽은 이미 돌고 있고, 그 결과를 사람이 보는
곳만 노션에 묶여 있다.**

두 시스템이 만난 지점이 이 문서다.

---

## 2. 확인된 사실

실제로 호출해 확인한 것과 코드에서 읽은 것을 구분해 적는다.

### 실제 호출로 확인 (2026-08-18)

| 확인 항목 | 결과 |
| --- | --- |
| `GET /backend/health` (Vercel 경유) | `{"status":"ok"}` · 첫 호출 **18.4초** |
| `GET /backend/public/portfolios/demo-designer` | 정상 JSON (profile·projects·documents·skillGroups) |

### 코드에서 확인

- **Vercel 주소 하나로 API 전체에 닿는다.** `apps/web/next.config.ts:46-54` 의 rewrites 가
  `/backend/:path*` 를 API 서버로 통째로 프록시한다. 이대리에 넣을 설정은 사이트 주소 한 개뿐이고,
  API 서버(Render) 주소는 알 필요가 없다.
- **API 서버는 15분 유휴 후 잠든다.** `render.yaml` 주석에 명시된 무료 플랜 특성이고, 위 18.4초가 그 실측이다.
  지금 사이트에 처음 들어온 방문자는 그 시간 동안 빈 화면을 본다.
- **쓰기 엔드포인트는 완비돼 있다.** `apps/api/src/content/content.controller.ts:64-137`
  — `PUT /me/portfolio`, `POST/PATCH/DELETE /me/projects`, 같은 형태로 `documents`, `skill-groups`.
- **기계가 쓸 인증 경로가 없다.** 유일한 로그인은 "구글 idToken → 7일 세션 쿠키"
  (`apps/api/src/auth/session.service.ts:14` 의 `expiresIn: "7d"`). 자동화를 이 쿠키로 붙이면
  7일 후 조용히 멈춘다.
- **이대리 쪽 승인 게이트 패턴이 이미 있다.** 외부 사이트에 쓰기를 하는 선례가
  `src/agent/blog/infrastructure/github-blog-publish.applier.ts` (노션 초안 → GitHub 발행, #310)이고,
  경력 파이프라인의 승인 카드는 `src/autopilot/infrastructure/tasks/evening-retro-publish.autopilot-task.ts:233`
  에서 생성된다.

---

## 3. 데이터가 이미 맞는다

이대리가 합성하는 성과 항목(`ProfileAccomplishment`)은 STAR — 상황(Situation)·과제(Task)·행동(Action)·
결과(Result) — 구조다. 사이트의 프로젝트 스키마는 문제·과정·결과 구조다. 둘이 사실상 같은 틀이라
변환에 창작이 필요 없다.

| 이대리 (`career-mate.type.ts`) | 사이트 프로젝트 필드 | 비고 |
| --- | --- | --- |
| `title` | `title` | 그대로 |
| `bullet` | `summary` | 한 줄 요약 |
| `star.situation` | `problem` | 문제 정의 |
| `star.task` + `star.action` | `process[]` | 배열 두 항목으로 분해 |
| `star.result` | `result` | 성과 |
| `techTags[]` | `techStack` / `tools[]` | 사이트는 둘로 나뉘어 있음 |
| `evidence[].url` | `links.github` | PR 링크가 근거로 남는다 |
| `evidence[].mergedAt` | `period` | 최소~최대 월로 환산 |
| (없음) | `slug` | 제목에서 생성 필요 |

스킬도 대응된다. 이대리의 `ProfileSkill{name, category, proficiency}` 에서 `category`
(LANGUAGE·FRAMEWORK·DOMAIN·TOOL)가 사이트 `skillGroups[].title` 이 되고, 같은 카테고리의 `name` 들이
`skills[]` 배열이 된다.

**남는 문제 하나** — 사이트 프로젝트는 `problem`·`process`·`result` 를 가진 "작품" 단위인데,
이대리의 성과 항목은 PR 묶음 단위다. 사람이 보기에 하나의 프로젝트인 것이 PR 여러 건에 흩어져 있으면
항목이 잘게 쪼개진다. 초안을 사람이 승인하는 구조로 두는 이유가 여기에 있다(§4-C).

---

## 4. 설계 — 세 갈래

### A. 잠든 API 깨우기 + 감시

**문제** — 무료 플랜이 잠들어 첫 방문자가 18초를 기다린다.
**설계** — autopilot 플레이북에 슬롯 하나를 추가해 정해진 주기로 `/backend/health` 를 호출하고,
연속 실패 시에만 Slack으로 알린다(매 회차 보고 금지 — 조용한 계기판 원칙).

- 추가 위치: `src/autopilot/domain/autopilot.playbook.ts` + `autopilot.playbook-defaults.ts` 상수 2개
  (cron·timezone), 태스크 구현은 `src/autopilot/infrastructure/tasks/` 에 신규 1파일.
- 주기: `*/10 8-23 * * *` — **시간대를 반드시 제한한다.** 간격은 Render 유휴 기준 15분보다 짧아야 하고,
  가동 시간은 월 상한 750시간을 넘지 않아야 한다(아래 계산).
- 신규 env: 사이트 주소 1개(`PORTFOLIO_SITE_URL`). 등록 4곳 동기 갱신 규칙 준수
  (`.env.example`·`.env`·`src/config/app.config.ts`·README 표).
- 인증 불필요 — 공개 GET만 쓴다. 따라서 **B와 무관하게 먼저 완결된다.**
- 실패 판정은 "이유 필드"를 남긴다. 조용한 0건/false 실패를 만들지 않는다.

**시간대를 제한하는 이유 (2026-08-18 Render 문서 확인)** — 무료 플랜은 워크스페이스당 월 750
인스턴스 시간을 주고, 소진하면 **그 달이 끝날 때까지 모든 무료 웹 서비스를 정지**시킨다. 잠들어 있는
동안은 시간을 소비하지 않으므로, 워밍업 주기가 곧 과금 시간이다.

| 워밍업 범위 | 월 소비(31일 기준) | 750시간 대비 여유 |
| --- | --- | --- |
| 24시간 상시 | 744시간 | 6시간 (0.8%) — 사실상 없음 |
| 08~24시 (16시간) | 496시간 | 254시간 |
| 09~19시 (10시간) | 310시간 | 440시간 |

상시 가동은 숫자상 통과하지만 여유가 0.8%다. 무료 서비스를 하나라도 더 만들거나 배포가 몇 번 겹치면
초과하고, 그 결과는 경고가 아니라 **사이트 정지**다. 낮 시간대만 깨우는 쪽을 기본값으로 둔다.

### B. 자동화 전용 인증 경로 (사이트 레포 변경)

**문제** — 기계용 토큰이 없어 쓰기 자동화가 7일 시한폭탄이 된다.
**설계** — 가장 작은 변경으로, 기존 JWT 가드가 자동화 토큰 헤더도 통과시키게 한다.

- 변경 대상: `apps/api/src/auth/jwt-auth.guard.ts` (+ `config.ts` 에 env 1개).
- 형태: `AUTOMATION_TOKEN` 과 그 토큰이 대변할 `AUTOMATION_USER_ID` 를 env로 두고,
  헤더로 온 토큰이 일치하면 그 사용자로 인증 처리. 대조는 상수 시간 비교(`timingSafeEqual`).
- 노출 범위를 좁힌다: 자동화 토큰은 `/me/*` 쓰기에만 허용하고 `admin/*` 는 막는다.
  (admin 엔드포인트에는 사용자 삭제·역할 변경이 있다 — `admin-users.controller.ts:39`.)
- 이대리 쪽 `.env` 에 토큰을 두고, CLI 자식 프로세스로 새지 않게 `buildSafeChildEnv` 경로를 확인한다.
  로그에 실행 인자를 그대로 찍지 않는다.

대안으로 "구글 리프레시 토큰을 이대리가 보관하고 idToken을 갱신" 방식도 있지만, 구현량이 크고
사이트에 refresh 흐름 자체가 없어 기각한다.

### C. 포트폴리오 사이트 발행 (승인 카드)

**설계** — 노션에 렌더하던 것과 **같은 데이터로 사이트에도 발행**한다. 새 PreviewKind 하나 +
applier 하나 + verifier 하나. 기존 블로그 발행(#310)과 구조가 동일하다.

1. `PREVIEW_KIND.PORTFOLIO_SITE_PUBLISH` 추가 (`src/preview-gate/domain/preview-action.type.ts`).
2. applier 신규 — `src/agent/career-mate/infrastructure/portfolio-site-publish.applier.ts`.
   payload는 §3 매핑을 적용한 프로젝트·스킬 그룹 배열. `POST/PATCH /me/projects` 로 반영한다.
   같은 성과가 두 번 올라가지 않게 `slug` 를 멱등 키로 쓴다(사이트에 `(userId, slug)` 유니크 제약이 있다 —
   `project.entity.ts:11`). 즉 **있으면 PATCH, 없으면 POST.**
3. verifier 신규 — 발행 후 `GET /public/portfolios/{handle}` 를 재조회해 그 slug가 실제로 보이는지 확인.
   `ResultVerifier` 계약이 이미 이 용도다.
4. **승인 카드를 새로 만들지 않는다(결정).** 발행은 `published: false` — 비공개 초안으로만 들어가므로
   공개되는 부작용이 없고, "공개" 게이트는 사이트 편집기에 이미 사람 손으로 존재한다. 승인 카드를
   한 장 더 늘리면 이 레포에서 관측된 패턴(카드 상당수가 무응답으로 만료)을 그대로 답습해, 승인을
   기다리다 초안조차 남지 않는다. 되돌리기 쉬운 쪽(비공개 초안)은 자동으로 두고, 되돌리기 어려운
   쪽(공개 게시)만 사람이 누른다.
5. 실행 지점 — 저녁 회고 경로에 얹지 않고 **단독 autopilot 슬롯**(`portfolio-publish`, 매일 23:00 KST)으로
   둔다. 저녁 회고(19:00)가 프로필을 갱신하고 그 승인 카드가 눌릴 여유를 4시간 두기 때문이고, 노션 발행과
   완전히 독립돼 한쪽 실패가 다른 쪽을 막지 않는다. 승인이 안 눌린 날은 이전 프로필을 다시 밀어 넣지만
   slug 멱등이라 중복 항목이 생기지 않는다.
6. 갱신은 매일 발생하므로 **갱신만 있는 날은 Slack에 올리지 않는다**. 신규·실패·건너뜀만 보고한다
   (갱신을 매일 알리면 알림이 배경 소음이 된다).
7. 갱신 시 `published` 는 payload에서 제외한다 — 사람이 편집기에서 이미 게시한 항목을 자동 발행이
   다시 비공개로 되돌리면 안 된다.

---

## 5. 실행 순서

```
A (워밍업·감시) ──── 독립. 지금 바로 가능. 토큰 불필요.
                          │
B (자동화 토큰) ──────────┴──> C (사이트 발행 applier)
   사이트 레포 변경              이대리 레포 변경
```

A는 B·C와 의존이 없어 먼저 끝낼 수 있다. C는 B 없이는 인증이 7일마다 끊기므로 B가 선행이다.
A와 B는 서로 다른 레포를 건드리므로 PR도 각각 나간다.

---

## 6. 리스크와 아직 확인하지 않은 것

| 항목 | 상태 |
| --- | --- |
| Render 무료 플랜 월 인스턴스 시간 상한 | **확인 완료(2026-08-18)** — 워크스페이스당 750시간/월, 초과 시 무료 웹 서비스 전체 정지. 24시간 워밍업은 여유 0.8%라 채택하지 않는다(§4-A 표). |
| 자동화 토큰의 대상 사용자(handle) | 미확인. 본인 계정 handle을 확정해야 C의 발행 대상이 정해진다. |
| 성과 항목 → 프로젝트 단위 어긋남 | §3에 적은 대로 남아 있음. 승인 게이트로 흡수하되, 항목이 과하게 쪼개지면 합치는 규칙이 필요할 수 있다. |
| 사이트 API 스키마 변경 | 사이트는 활발히 개발 중(#91까지). `data` 가 자유 jsonb라 필드가 조용히 바뀔 수 있고, 그러면 발행이 형태 불일치로 실패한다. verifier(재조회)가 이 실패를 드러내는 장치다. |
| 이대리 → Vercel 아웃바운드 | 방향이 밖으로 나가는 호출이라 별도 터널이 필요 없다. 반대 방향(사이트가 내 맥을 호출)은 이 설계에 없다. |

---

## 7. 확정한 결정

| 결정 | 선택 | 근거 |
| --- | --- | --- |
| A 워밍업 시간대 | **`*/10 8-23 * * *`** (08~24시, KST) | 월 496시간으로 750시간 상한에 254시간 여유. 상시 가동은 여유가 0.8%뿐이라 배제(§4-A). 환경변수 `AUTOPILOT_PORTFOLIO_WARMUP_SCHEDULE` 로 조정 가능. |
| C 승인 카드 | **만들지 않음** | 비공개 초안 발행은 외부 부작용이 아니고, 공개 게이트가 사이트 편집기에 이미 있다(§4-C). |
| C 발행 범위 | **프로젝트 + 스킬 그룹만** | 프로필 소개글(`profile.shortBio`)은 손으로 쓴 문장이라 자동 생성물로 덮지 않는다. |

---

## 8. 범위 밖

- 사이트를 이대리 안으로 옮기거나 DB를 합치는 일. 두 시스템은 API로만 만난다.
- 사이트의 커스텀 도메인·서브도메인 라우팅(**사이트 레포**(이 저장소가 아니다)의 `docs/subdomain-routing-design.md` 소관).
- 이대리가 사이트의 방문 통계를 읽는 방향(수집 자체가 없다).
