# 백엔드 채용공고 자동 수집 (`job-feed`) 설계

작성 2026-08-27 · 상태: 승인 대기 · 구현 전

---

## 1. 배경과 목표

이대리는 이미 커리어 쪽 기능을 갖추고 있다. GitHub PR로 커리어 프로필을 만들고(`BUILD_PROFILE`), 채용 공고(JD)를 붙여넣으면 "내가 가진 것과 부족한 것"을 갈라주며(`ANALYZE_JD_GAP`), 등록한 목표 공고 기준으로 이력서를 감사한다(`AUDIT_RESUME`).

빠진 것은 **입구**다. 공고를 사람이 직접 찾아 복사해 넣어야 한다.

이 설계는 백엔드 개발자 공고를 정기적으로 모아 세 가지를 뽑아내고, 그 결과를 기존 커리어 기능에 물린다.

1. **요구 스킬 태그화** — 공고가 원하는 기술을 정규화된 태그로
2. **요구 연차** — 몇 년차를 뽑는지
3. **회사**

### 성공 기준

- 매일 아침 새 공고가 슬랙 카드로 도착하고, 내 조건에 맞는 것만 걸러져 있다.
- 상위 후보는 갭 분석이 붙어 온다.
- 수집이 실패하거나 결과가 0건이면 **그 사실이 카드에 드러난다**.

---

## 2. 확정된 결정

| 항목 | 결정 |
|---|---|
| 수집 소스 | 점핏 · 랠릿 · 원티드 (잡코리아 · 사람인은 후속) |
| 목적지 | 아침 슬랙 카드 + 상위 N건 갭 분석 자동 연결 |
| 스킬 추출 | 소스 제공 태그를 사전으로 정규화, 본문 추출은 후속 |
| 저장 범위 | 전량 저장, 알림만 조건 필터 |
| 조건 출처 | 커리어 프로필 + 환경설정(연차 · 지역) |
| 갭 분석 | 상위 N건만 자동 (기본 2) |

---

## 3. 소스 실측

2026-08-27 직접 호출로 확인한 값이다. 추정이 아니다.

### 3-1. 점핏

- 목록 `GET https://jumpit-api.saramin.co.kr/api/positions?page={n}&jobCategory=1&sort=rsp_rate` → HTTP 200, `result.totalCount=126`, 페이지당 16건
- 상세 `GET https://jumpit-api.saramin.co.kr/api/position/{id}` → HTTP 200

| 필요한 것 | 필드 | 실측값 |
|---|---|---|
| 스킬 | 목록 `techStacks[]` (문자열 배열) | `["Java","Spring Boot","REST API","AWS","MSA"]` |
| 스킬(상세) | `techStacks[]` (**객체 배열**) | `[{stack:"Java", imagePath:"..."}]` |
| 연차 | `minCareer` / `maxCareer` | `5` / `20` |
| 회사 | `companyName` | `씨어스테크놀로지` |
| 지역 | `locations[]` | `["경기 성남시 분당구"]` |
| 본문 | 상세 `qualifications` · `preferredRequirements` · `responsibility` | 원문 그대로 |

> 목록과 상세에서 `techStacks`의 형태가 다르다. 같은 이름의 필드가 문자열 배열과 객체 배열로 갈린다.

### 3-2. 랠릿

- 목록 `GET https://www.rallit.com/api/v1/position?jobGroup=DEVELOPER&pageNumber={n}&pageSize={m}` → HTTP 200, `data.totalCount=301`, `data.items[]`

| 필요한 것 | 필드 | 실측값 |
|---|---|---|
| 스킬 | `jobSkillKeywords[]` | `["React","TypeScript","Next.js","vite"]` |
| 연차 | `jobLevel` (열거값) | 100건 분포: `IRRELEVANT` 51 · `MIDDLE` 39 · `JUNIOR` 7 · `SENIOR` 2 · `BEGINNER` 1 |
| 회사 | `companyName` | — |
| 지역 | `addressRegion` (**영문 구역 코드**) | `GANGNAM` 52 · `SEOUL` 19 · `GURO_GASAN` 9 · `MAPO` 7 · `PANGYO` 5 · `GYEONGGI` 5 · `ETC` 3 |
| 상세 | 미확인 | 목록에 `url`만 있음 |

**직군 필터 파라미터를 찾지 못했다.** `jobCategory` · `jobCategories` · `filter`는 어떤 값을 넣어도 무시되고(총 301 동일), `job=`은 인식되나 결과가 0건이다. 실제로 프론트엔드 공고가 섞여 들어온다(`["React","TypeScript",...]`). → 전량 수신 후 코드에서 거른다.

### 3-3. 원티드

- 목록 `GET https://www.wanted.co.kr/api/v4/jobs?country=kr&job_sort=job.latest_order&years=-1&locations=all&limit={n}&offset={m}&category_tags={id}` → HTTP 200
- 상세 `GET https://www.wanted.co.kr/api/v4/jobs/{id}` → HTTP 200

| 필요한 것 | 필드 | 비고 |
|---|---|---|
| 스킬 | **상세** `skill_tags[{title,...}]` | 목록에는 없다 |
| 연차 | `annual_from` / `annual_to` | `3` / `5` |
| 회사 | `company.name` | — |
| 지역 | `address.location` (**한글**) | `서울` |
| 본문 | 상세 `detail{requirements, main_tasks, preferred_points}` | — |

두 가지 함정이 확인됐다.

- **`annual_to`에 `100`이 들어온다.** 상한 없음을 나타내는 표식이며, 그대로 저장하면 "3~100년차 모집"이 된다.
- **백엔드 카테고리 ID를 찾지 못했다.** `category_tags=872`로 호출하면 HTTP 200에 20건이 정상적으로 오는데, 내용은 **전부 디자이너 공고**였다(`skill_tags`에 타이포그래피 · Zeplin · UI 디자인). 에러도 0건도 아닌 채로 틀린 데이터가 들어온다. `/api/v4/tags/categories`와 `/api/v4/categories`는 404다.

---

## 4. 아키텍처

### 4-1. 모듈 배치

`job-feed`는 **커리어 기능을 알지 못한다.** 두 도메인을 엮는 일은 autopilot task가 맡는다. 이 레포의 정기 실행 30건이 예외 없이 그 방향이다 — [portfolio-publish.autopilot-task.ts](../../../src/autopilot/infrastructure/tasks/portfolio-publish.autopilot-task.ts)가 커리어 유스케이스 둘을 조합하고, [autopilot.module.ts](../../../src/autopilot/autopilot.module.ts)가 `CareerMateModule`을 가져다 쓰되 그 반대는 없다.

이 방향을 지키는 실질적 이유가 하나 더 있다. `JobFeedModule`이 `CareerMateModule`을 가져오면 그것이 딸고 오는 GitHub · Notion · Humanize · ModelRouter 배선이 전부 의존 그래프에 얹힌다. 그러면 §4-11의 수집 CLI가 HTTP와 DB만 필요한데도 그 전부를 부팅해야 한다.

```
src/job-feed/                                    커리어 기능을 모른다
  domain/
    job-feed.type.ts
    port/job-source.port.ts                      fetchList 만
    port/job-detail-source.port.ts               fetchDetail 을 더한 확장
    port/job-posting.repository.port.ts
    skill-dictionary.ts                          별칭 → 정규명 (양방향 적용)
    experience.ts                                등급 ⟷ 연차구간 변환
    location.ts                                  소스별 지역 표기 → 시도
    backend-role.filter.ts                       직군 판별 (모든 소스 공통)
    match-score.ts                               결정론 점수
    dedupe.ts                                    normalizedKey / companyKey
  infrastructure/
    http-constants.ts                            공용 UA · 타임아웃
    job-feed-rate-limit.error.ts
    jumpit.source.ts   + jumpit.mapper.ts
    rallit.source.ts   + rallit.mapper.ts
    wanted.source.ts   + wanted.mapper.ts
    job-posting.prisma.repository.ts
    job-feed.formatter.ts
  application/
    collect-job-postings.usecase.ts              수집 → 검증 → 정규화 → upsert
    score-job-postings.usecase.ts                프로필 대비 채점
    list-notifiable-postings.usecase.ts          알림 후보 조회 + 원자적 선점
    fetch-posting-detail.usecase.ts              상위 후보 본문 수집
    reprocess-job-postings.usecase.ts            사전 갱신 후 재파생
  interface/
    job-feed-cli.parser.ts
  job-feed.module.ts

src/autopilot/infrastructure/tasks/
  job-feed.autopilot-task.ts                     수집 + 채점 + 아침 카드
  job-feed-gap.autopilot-task.ts                 상위 N건 갭 분석 (별도 슬롯)

scripts/job-feed.ts                              검증 진입점
```

HTTP 컨트롤러는 두지 않는다. 부를 주체가 없다. 검증은 CLI가, 발화는 정기 실행이 맡는다.

### 4-2. 데이터 모델

```prisma
model JobPosting {
  id              Int       @id @default(autoincrement())
  source          String                                   // 'jumpit' | 'rallit' | 'wanted'
  sourceId        String    @map("source_id")
  company         String
  companyKey      String    @map("company_key")            // 정규화 회사명 — "(주)토스" 와 "토스" 를 묶는다
  title           String
  detailUrl       String    @map("detail_url")

  // 스킬 — 원본을 함께 남긴다. 사전을 고친 뒤 과거 행을 되살리는 재료다.
  skillTags       String[]  @map("skill_tags")
  rawSkillTags    String[]  @map("raw_skill_tags")

  // 연차 — 관측값과 환산값을 구분한다. 환산표가 바뀌면 어느 행이 환산본인지 알아야 한다.
  minYears        Int?      @map("min_years")
  maxYears        Int?      @map("max_years")              // 상한 없음은 null (원티드 100 은 여기서 null 로)
  yearsSource     String    @map("years_source")           // 'RANGE' | 'LEVEL'
  rawJobLevel     String?   @map("raw_job_level")          // 랠릿 원본 등급
  experienceLevel String?   @map("experience_level")       // newcomer|junior|mid|senior|any

  locations       String[]                                 // 시도 라벨
  rawLocations    String[]  @map("raw_locations")          // 소스 원본 표기

  // 본문 — 상위 후보만 채운다. null 이 정상이다. §4-8 참조.
  jdText          String?   @map("jd_text") @db.Text
  detailFetchedAt DateTime? @map("detail_fetched_at")

  normalizedKey   String    @map("normalized_key")         // companyKey + 정규화 제목
  contentHash     String    @map("content_hash")           // 요건 변경 감지용

  // 채점 — 어느 프로필 기준인지 남긴다. 프로필이 갱신되면 이 값은 낡는다.
  matchScore      Int?      @map("match_score")
  scoredProfileId Int?      @map("scored_profile_id")
  scoredAt        DateTime? @map("scored_at")

  firstSeenAt     DateTime  @default(now()) @map("first_seen_at")
  lastSeenAt      DateTime  @default(now()) @map("last_seen_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
  closedAt        DateTime? @map("closed_at")
  notifiedAt      DateTime? @map("notified_at")

  gapAgentRunId   Int?      @map("gap_agent_run_id")
  gapAgentRun     AgentRun? @relation(fields: [gapAgentRunId], references: [id], onDelete: SetNull)

  applications    JobApplication[]

  @@unique([source, sourceId])
  @@index([normalizedKey])
  @@index([notifiedAt, matchScore])
  @@index([companyKey])
  @@map("job_posting")
}
```

함께 바뀌는 기존 모델:

- `AgentRun`에 `jobPostings JobPosting[]` 역참조 추가. 이 레포의 `agentRunId` 컬럼은 예외 없이 관계로 선언돼 있다.
- `JobApplication`에 `jobPostingId Int?` + 관계 추가. 값은 당분간 비어 있어도 되지만, 나중에 붙이려면 이미 쌓인 지원 이력을 문자열로 대조해 메워야 한다.

반영은 `pnpm prisma:generate` → `pnpm db:push`. 이 레포는 마이그레이션 파일을 쓰지 않는다. `db:push` 실행 전 출력 전문을 확인한다 — 손으로 만든 인덱스를 지우는 사고가 있었다.

### 4-3. 스킬 태그화

소스마다 같은 기술을 다르게 적는다. 별칭 사전으로 정규명 하나에 모은다.

| 기술 | 점핏 | 원티드 | 랠릿 |
|---|---|---|---|
| Spring Boot | `Spring Boot` | `Spring` | `SpringBoot` |

**정규화는 공고와 프로필 양쪽에 적용한다.** 한쪽만 다듬으면 사전이 반쪽만 작동한다.

#### 매칭 코퍼스 — 프로필의 어느 필드를 쓰는가

커리어 프로필에는 기술 목록이 두 군데 있다. **`accomplishments[].techTags`를 쓴다.** `skills[].name`은 쓰지 않는다.

실제 저장된 값을 조회해 정한 것이다(`career_profile` 19행):

```
skills[].name — distinct 12개
  API Design · CI / Docs-as-Code · Firebase Functions / Firestore / Hosting
  LLM Agent Systems · NestJS · Operational Dashboards
  PostgreSQL / Prisma / pgvector · Puppeteer Crawling · Queue / Worker Reliability
  Slack App Development · SMS / OTP Abuse Prevention · TypeScript

accomplishments[].techTags — distinct 123개
  Astro · Backend API · BullMQ · CI · class-validator · CORS · CSRF · Docker
  Elasticsearch · Express · FCM · Firebase · Cron · Domain-Driven Design · …
```

`skills[].name`은 공고 태그와 층위가 맞지 않는다. 슬래시로 세 기술을 묶었거나(`PostgreSQL / Prisma / pgvector`), 공고에 나올 리 없는 추상 문구(`Operational Dashboards`)다. 점핏 백엔드 공고의 `["Java","Spring Boot","REST API","AWS","MSA"]`와 겹치는 것이 하나도 없다.

이유는 [career-profile-synth.prompt.ts:15](../../../src/agent/career-mate/domain/prompt/career-profile-synth.prompt.ts#L15)에 있다. 카테고리와 숙련도만 열거값으로 묶여 있고 이름에는 제약이 없어 모델이 자유롭게 짓는다. 반면 `techTags`는 원자 토큰으로 생성돼 공고 태그와 같은 층위다.

> `techTags`도 자유 생성이라 자체 흔들림이 있다(같은 코퍼스에 `OpenAPI`와 `Swagger/OpenAPI`가 공존). 사전이 양쪽에 걸리는 이유다.

#### 사전에 없는 태그

버리지 않고 `rawSkillTags`에 남긴다. 사전을 고친 뒤 `reprocess`로 과거 행의 `skillTags`와 점수를 되살린다. 이 재파생 경로가 없으면 `rawSkillTags`는 아무도 읽지 않는 죽은 필드가 되고, 사전 갱신의 효과가 새 공고에만 적용된다.

미매칭 상위 토큰과 그 건수는 CLI 출력과 아침 카드 각주에 노출한다. 사람이 DB를 뒤져야만 알 수 있으면 사전은 갱신되지 않는다.

#### 카테고리

`SkillCategory`(`LANGUAGE`/`FRAMEWORK`/`DOMAIN`/`TOOL`) 부여는 **1차에서 하지 않는다.** §4-6 점수식에 쓸 자리가 없고, 쓰지 않는 값을 채우면 유지 비용만 남는다.

#### 본문 기술은 아직 못 잡는다

소스가 주는 태그는 대표 기술 몇 개뿐이다. "Kafka 우대"가 본문에만 있으면 `skillTags`에 안 들어가고 `rawSkillTags`에도 남지 않는다. 1차는 태그 기반이며, 본문 추출은 잡코리아·사람인을 붙일 때 함께 만든다. 이 한계를 §9에 명시한다.

### 4-4. 연차

소스마다 형태가 다르다. 정규식은 쓰지 않는다 — 세 소스 모두 숫자나 열거값을 주므로 결정론 변환으로 충분하고, 자유 텍스트용 정규식을 여기 쓰면 오히려 값을 망가뜨린다(뒤 §9 참조).

| 소스 | 원본 | 변환 | `yearsSource` |
|---|---|---|---|
| 점핏 | `minCareer` / `maxCareer` | 그대로 | `RANGE` |
| 원티드 | `annual_from` / `annual_to` | 그대로. **`annual_to >= 100`이면 `maxYears = null`** | `RANGE` |
| 랠릿 | `jobLevel` 열거값 | 아래 표 | `LEVEL` |

랠릿 등급 변환 (실측 5종):

| `jobLevel` | `minYears` | `maxYears` | `experienceLevel` |
|---|---|---|---|
| `BEGINNER` | 0 | 1 | `newcomer` |
| `JUNIOR` | 1 | 3 | `junior` |
| `MIDDLE` | 3 | 7 | `mid` |
| `SENIOR` | 7 | null | `senior` |
| `IRRELEVANT` | null | null | `any` |

원본 등급은 `rawJobLevel`에 남긴다. 표를 고쳤을 때 어느 행이 옛 표로 환산됐는지 알아야 한다.

숫자 구간을 주는 소스(점핏 · 원티드)는 반대 방향으로 등급을 매긴다. 위 표와 경계를 맞춘다.

| 조건 | `experienceLevel` |
|---|---|
| 소스가 신입 표식을 줌 (점핏 `newcomer: true`) | `newcomer` |
| `minYears`와 `maxYears`가 모두 null | `any` |
| `minYears >= 7` | `senior` |
| `minYears >= 3` | `mid` |
| `minYears >= 1` | `junior` |
| `minYears == 0`이고 `maxYears <= 1` | `newcomer` |
| 그 밖 (`minYears == 0`, 상한이 넓음) | `junior` |

판정은 위에서부터 처음 걸리는 것을 쓴다.

### 4-5. 회사와 중복 제거

- `companyKey` — 회사명에서 법인 표기(`(주)`, `주식회사`, `Inc.`)와 공백·기호를 걷어낸 값
- `normalizedKey` — `companyKey` + 정규화한 제목

같은 공고가 여러 소스에 오르면 행은 소스별로 남되(`@@unique([source, sourceId])`), **알림은 `normalizedKey` 단위로 한 번만** 나간다. 방법은 §4-9에 있다.

### 4-6. 매칭 점수

0~100 정수. 모델을 부르지 않는다.

- **스킬 겹침** — 정규화된 공고 태그 중 프로필 `techTags`에 있는 비율
- **연차 적합** — 내 연차가 `[minYears, maxYears]` 안이면 가점, 벗어나면 감점. `IRRELEVANT`(양쪽 null)는 중립
- **지역 일치** — 설정 지역과 겹치면 가점

기준점(기본 60) 이상만 알림 후보. 저장은 전량.

채점할 때 `scoredProfileId`와 `scoredAt`을 함께 쓴다. 프로필이 갱신되면 기존 점수는 낡은 것이 되는데, 그 사실이 행에 남아 있어야 재채점 대상을 고를 수 있다. 프로필을 다시 만든 뒤에는 `reprocess`로 재채점한다.

> 기준점 변경은 재채점이 필요 없다. 점수는 기준점과 무관하고 필터는 조회 시점에 걸린다.

**프로필이 없으면 채점하지 않는다.** 자동 실행 경로에서 프로필을 새로 만들지 않는다 — 그 작업은 GitHub PR 100건 조회와 모델 호출을 동반한다. 프로필 부재 시 task는 조용히 건너뛴다.

### 4-7. 지역

| 소스 | 원본 | 변환 |
|---|---|---|
| 점핏 | `["경기 성남시 분당구"]` | 첫 토큰이 시도 |
| 원티드 | `address.location` = `"서울"` | 그대로 |
| 랠릿 | `GANGNAM` / `PANGYO` / `GURO_GASAN` … | 코드 → 시도 대응표 |

랠릿 실측 코드 대응: `GANGNAM`·`SEOUL`·`GURO_GASAN`·`MAPO` → 서울, `PANGYO`·`GYEONGGI` → 경기, `ETC` → 없음. 목록에 없는 코드가 나오면 `rawLocations`에만 남기고 미매칭으로 계수한다.

문자열 포함 검사는 쓰지 않는다. 랠릿·원티드는 영문 코드라 한글 시도명과 겹치지 않는다.

### 4-8. 본문 수집 예산

`jdText`는 **모든 행에 채우지 않는다.** 점핏 126건 + 랠릿 301건이면 첫 실행에 상세 호출이 400회를 넘는다.

2단계로 나눈다.

1. **수집** — 목록만. `jdText`와 `detailFetchedAt`은 비워 둔다.
2. **채점 후** — 상위 후보와, 목록에 스킬이 없는 소스(원티드)의 알림 후보에 한해 상세를 가져와 `jdText`를 채우고 재채점한다.

제약:

- 슬롯당 상세 호출 상한 (`JOB_FEED_DETAIL_LIMIT`, 기본 20)
- 호출 간 고정 지연 (기본 500ms)
- `detailFetchedAt`이 24시간 이내면 다시 가져오지 않는다
- 공용 User-Agent와 타임아웃을 `http-constants.ts`에 상수로 둔다 — Node의 `fetch`에는 기본 타임아웃이 없어 응답이 없으면 무한정 매달린다

### 4-9. 알림 선점

`notifiedAt`을 조회한 뒤 발송하고 나중에 갱신하면, 정기 실행이 겹칠 때 같은 카드가 두 번 나간다. [autopilot.orchestrator.ts:76-92](../../../src/autopilot/application/autopilot.orchestrator.ts#L76-L92)의 재진입 가드는 **완주한 슬롯만** 막고 실행 중 재큐는 통과시킨다고 명시돼 있다.

레포에 이미 쓰는 조건부 선점 방식을 따른다([preview-action.prisma.repository.ts:98](../../../src/preview-gate/infrastructure/preview-action.prisma.repository.ts#L98)):

```ts
const { count } = await this.prisma.jobPosting.updateMany({
  where: { normalizedKey, notifiedAt: null },
  data: { notifiedAt: now },
});
// count === 0 이면 그 사이 다른 실행이 가져갔다 — 발송하지 않는다.
```

`where`를 `normalizedKey`로 잡으면 같은 공고의 다른 소스 행까지 함께 잠긴다. **컬럼을 늘리지 않고 경합과 교차 소스 중복을 함께 막는다.**

요건이 바뀐 공고는 다시 알린다. `contentHash`가 달라지면 upsert에서 `notifiedAt`을 비워 다음 카드에 "요건 변경"으로 올린다. 이것이 없으면 회사가 필수 기술을 추가해도 사용자는 영영 모른다.

### 4-10. 갭 분석 자동 투입

기존 `AnalyzeJdGapUsecase`를 자동으로 부르면 부수효과가 여럿 따라온다. 그중 셋을 반드시 다뤄야 한다.

#### 목표 공고 오염 — 가장 무거운 문제

체인이 이렇게 이어진다.

| 단계 | 위치 | 동작 |
|---|---|---|
| ① 갭 분석이 목표 JD를 저장 | [analyze-jd-gap.usecase.ts:102](../../../src/agent/career-mate/application/analyze-jd-gap.usecase.ts#L102) | 매 실행마다 |
| ② 저장 방식 | [career-target-jd.prisma.repository.ts:17](../../../src/agent/career-mate/infrastructure/career-target-jd.prisma.repository.ts#L17) | `create` — 부를 때마다 새 행 |
| ③ 이력서 감사가 조회 | [career-target-jd.prisma.repository.ts:31](../../../src/agent/career-mate/infrastructure/career-target-jd.prisma.repository.ts#L31) | 30일 내 **가장 최근 1건** |
| ④ 그 감사를 부르는 정기 실행 | [portfolio-publish.autopilot-task.ts:61](../../../src/autopilot/infrastructure/tasks/portfolio-publish.autopilot-task.ts#L61) | 매일 23시 |

자동 갭 분석이 매일 2건씩 행을 쌓으면, 사용자가 직접 등록한 목표 공고는 늘 뒤로 밀리고 이력서 감사가 **자동 수집물을 목표로 삼는다.**

회사·직무를 뽑는 [extractTargetJdIdentity](../../../src/agent/career-mate/application/analyze-jd-gap.usecase.ts#L42)는 "앞 3줄 중 가장 짧은 줄이 직무, 나머지가 회사"라는 규칙이다. 사람이 붙여넣은 JD를 전제한 함수다. §4-8이 조립하는 자격요건 문자열을 넣으면 회사명 자리에 `- MSA 경험` 같은 불릿이 들어가고, 그 값이 이력서 감사 카드에 그대로 렌더된다([resume-audit.prompt.ts:96](../../../src/agent/career-mate/domain/prompt/resume-audit.prompt.ts#L96) → [career-mate.formatter.ts:240](../../../src/agent/career-mate/infrastructure/career-mate.formatter.ts#L240)).

`career_target_jd`는 현재 **0행**이다. 이 추출 함수는 운영에서 한 번도 실행된 적이 없고, 이 기능이 첫 사용자가 된다.

#### 대기 카드 가로채기

[preview-action.prisma.repository.ts:67](../../../src/preview-gate/infrastructure/preview-action.prisma.repository.ts#L67)의 조회에는 종류 필터가 없다. 사용자의 대기 카드 중 **가장 최근 1건**을 가져온다. 아침에 자동 생성된 갭 분석 카드가 살아 있으면, 사용자가 다른 맥락에서 "1번"이라고 답할 때 그 카드가 가로채 **본 적 없는 공고의 주제로 블로그 발행 체인이 발사된다.** 되돌리기 어려운 외부 부작용이다.

#### 자동 호출 계약

`AnalyzeJdGapInput`을 확장한다.

```ts
export interface AnalyzeJdGapInput {
  slackUserId: string;
  jdText: string;
  // 없으면 기존 멘션 경로 — 기존 호출부는 그대로 둔다.
  triggerType?: TriggerType;
  company?: string;
  role?: string;
  origin?: 'USER' | 'JOB_FEED';
}
```

경로별 동작:

| 부수효과 | 사용자 멘션 | 자동 수집 |
|---|---|---|
| 실행 원장 기록 | 유지 | 유지하되 전용 트리거로 구분 |
| 목표 JD 저장 | 유지 | **하지 않음** |
| 회사·직무 추출 | 앞 3줄 휴리스틱 | **`JobPosting.company` / `title`을 그대로 전달** |
| 블로그 주제 카드 | 유지 | **띄우지 않음** |

`TriggerType`에 `AUTOPILOT_JOB_FEED_GAP_CRON`을 추가한다. 지금은 트리거가 [analyze-jd-gap.usecase.ts:89](../../../src/agent/career-mate/application/analyze-jd-gap.usecase.ts#L89)에 "슬랙 멘션"으로 하드코딩돼 있어, 그대로 두면 자동 실행이 수동 사용 통계에 영구히 섞인다.

#### 중복 분석 방지

상위 N건 선별에 `gapAgentRunId IS NULL` 조건을 넣는다. 프로필이 그대로면 점수도 그대로라 같은 공고가 며칠씩 상위에 머문다. 조건이 없으면 매일 같은 공고를 다시 분석한다.

### 4-11. 스케줄

**아침 그룹에 넣지 않는다.** 두 개의 독립된 정기 실행 항목으로 나눈다.

| 항목 | 내용 | 모델 호출 |
|---|---|---|
| `job-feed` | 수집 · 채점 · 상세 보강 · 아침 카드 | 없음 |
| `job-feed-gap` | 상위 N건 갭 분석 | N회 |

이유는 실행 시간 예산이다. [worker-options.constant.ts](../../../src/common/queue/worker-options.constant.ts)의 잠금 시간은 `모델 호출 1회 최악치(606초) + 90초`로 산정돼 있다. 한 그룹은 순차 실행이므로([autopilot.orchestrator.ts:112](../../../src/autopilot/application/autopilot.orchestrator.ts#L112)) 아침 그룹에 갭 분석 2회를 얹으면 예산을 넘긴다. 넘기면 BullMQ가 죽은 작업으로 보고 재실행하는데, 재진입 가드는 완주한 슬롯만 막으므로 통과한다. 같은 자리에서 실제로 일어났던 사고다 — 주석에 **12회 연쇄 재실행, 각 16~33분, 모델 호출 12회 낭비**로 기록돼 있다.

`job-feed`를 아침 카드보다 앞선 시각에 두고, 카드는 이미 적재된 결과를 읽기만 한다.

플레이북 그룹에 넣지 않으므로, 그룹 첫 항목 이름으로 환경변수 키를 만드는 규칙에도 걸리지 않는다.

#### 등록 지점 — 빠뜨리면 첫 발화에 아침이 통째로 죽는다

정기 실행 항목을 추가하려면 네 곳을 함께 손봐야 한다.

1. `src/autopilot/infrastructure/tasks/job-feed.autopilot-task.ts` (`AutopilotTask` 구현, `readonly id = 'job-feed'`)
2. `autopilot.module.ts`의 `providers`
3. `AUTOPILOT_TASKS`의 **useFactory 인자 · 반환 배열 · inject 세 곳 모두**
4. 플레이북 항목

3번의 반환 배열을 빠뜨리면 컴파일도 테스트도 CI도 통과하고, 슬롯이 처음 발화하는 순간 `Autopilot: task 미등록`으로 **그룹 전체가 죽는다**. [autopilot.module.ts:216](../../../src/autopilot/autopilot.module.ts#L216)에 "실제로 겪었다"고 적혀 있다.

함께 추가할 것: 플레이북의 모든 `taskId`가 `AUTOPILOT_TASKS`에 존재하는지 검사하는 테스트. 현재 검증 함수는 이름 중복과 그룹 스케줄만 본다.

### 4-12. 응답 검증과 관측

#### 응답을 믿지 않는다

네트워크 응답은 `unknown`으로 받아 매퍼에서 검사한 뒤에만 도메인 타입으로 넘긴다. 이 레포의 기존 외부 API 매퍼가 쓰는 방식이다([toss-market-data.mapper.ts](../../../src/market-data/infrastructure/toss/toss-market-data.mapper.ts) — 수동 타입 가드 + 실패 시 `null`). 새 검증 라이브러리는 들이지 않는다.

- 최상위 구조가 어긋나면 **소스 실패**
- 개별 항목이 어긋나면 그 항목만 버리고 계수 (표본 하나를 로그에 남긴다)

점핏 `techStacks`가 목록과 상세에서 형태가 다르므로(§3-1), 두 경로의 매퍼를 따로 둔다.

#### 3단 계수 — 조용한 실패를 드러낸다

소스마다 **원시 수신 / 검증 통과 / 직군 필터 통과** 세 건수를 따로 센다.

이 기능에서 가장 위험한 실패는 에러가 아니다. 원티드에 잘못된 카테고리를 넣었을 때 HTTP 200에 20건이 정상적으로 왔고 **내용만 디자이너 공고**였다(§3-3). 3단 계수가 있으면 "수신 20 / 검증 20 / 직군 통과 0"으로 드러난다.

**원시 수신이 0보다 큰데 검증 통과가 0이면 실패로 처리한다.** 이것이 소스의 응답 형태 변경을 잡는 유일한 자동 신호다.

#### 직군 판별 필터

랠릿은 직군 파라미터가 듣지 않고, 원티드는 카테고리 ID가 미확정이다. 그래서 **모든 소스에 공통 직군 필터를 적용한다** — 제목과 스킬 태그로 백엔드 공고인지 판별한다. 소스 필터가 틀려도 여기서 걸린다.

#### 재시도와 감속

[CODE_RULES.md §12](../../../CODE_RULES.md)의 크롤링 규칙(MUST)이 이 기능에 그대로 적용된다.

- 429와 일시적 5xx만 제한 재시도(소스당 1회), 401·403·404는 즉시 실패
- 재시도 간 지수 백오프, 요청 간 고정 지연
- 저장은 upsert로 멱등
- 429 전용 오류 타입을 둔다(기존 `MarketDataRateLimitError` 선례)

전용 큐는 만들지 않는다. 정기 실행 task 안에서 돌고, 재시도 판단은 유스케이스가 한다. 시세 수집 쪽이 이미 그 방식이다.

#### 실행 원장

수집 실행을 `AgentRunService`로 감싼다. 이 레포는 모든 에이전트 실행이 DB에 흔적을 남기는 것을 원칙으로 한다.

`output`에 남길 것: 소스별 상태와 HTTP 코드, 3단 계수, 소요 시간, 마지막 성공 시각, 저장 건수, 갭 분석 성공·실패 수.

부분 실패(일부 소스만 실패)는 성공으로 기록하되 상태에 명시한다. 전체 실패와 "수신은 있는데 검증 0"은 실패로 기록한다.

#### 카드에 드러내기

아침 카드 끝에 소스별 상태를 고정으로 붙인다.

```
점핏 126건 · 랠릿 301건(백엔드 42) · 원티드 실패(HTTP 403)
사전 미매칭 태그 7종: Quarkus, Temporal, …
```

한 소스가 조용히 빠진 것을 사람이 알아차릴 유일한 경로다.

---

## 5. 환경변수

전부 선택 항목이다. 기능이 꺼진 기본 상태에서 키가 하나도 없어도 부팅돼야 한다.

| 키 | 필수 | 기본값 | 뜻 | 없을 때 |
|---|---|---|---|---|
| `JOB_FEED_ENABLED` | 선택 | 빈 값(꺼짐) | 기능 스위치 | 수집·알림 모두 하지 않음 |
| `JOB_FEED_YEARS` | 선택 | 없음 | 내 연차 (정수 0~50) | 연차 가점을 중립으로 |
| `JOB_FEED_LOCATIONS` | 선택 | 없음 | 희망 지역 (쉼표 구분 시도명) | 지역 가점을 중립으로 |
| `JOB_FEED_MATCH_THRESHOLD` | 선택 | 60 | 알림 기준 점수 (0~100) | 기본값 |
| `JOB_FEED_GAP_ANALYSIS_TOP_N` | 선택 | 2 | 자동 갭 분석 건수 (0~5) | 기본값 |
| `JOB_FEED_DETAIL_LIMIT` | 선택 | 20 | 슬롯당 상세 호출 상한 (1~100) | 기본값 |

`JOB_FEED_YEARS`나 `JOB_FEED_LOCATIONS`가 비어 있으면 그 축을 빼고 점수를 매긴다. 0점 처리하지 않는다 — 설정을 안 한 것과 조건에 안 맞는 것은 다르다.

갱신할 곳:

1. `src/config/app.config.ts` (검증 규칙 포함 — 숫자는 정수·범위, 목록은 빈 항목 제거)
2. `.env.example`
3. `.env`
4. README 표
5. `pnpm docs:sync` 산출물 (`docs/env-catalog.md`)
6. `scripts/sync-docs.ts`의 그룹 규칙에 `JOB_FEED_` 접두사 한 줄
7. `scripts/check-invariants.cjs`의 자율 기능 플래그 목록에 `JOB_FEED_ENABLED`

7번을 빠뜨려도 CI는 실패하지 않는다. 검사가 아예 돌지 않을 뿐이다. 외부 호출과 모델 호출과 슬랙 발송을 하는 기능이 기본 켜짐으로 나가도 잡히지 않는다.

---

## 6. 검증

### 실행 게이트

CI 순서 그대로 여섯 단계다.

```bash
pnpm check:env && pnpm docs:check && pnpm check:invariants \
  && pnpm lint:check && pnpm test && pnpm build
```

`prisma/schema.prisma`를 고쳤으면 `pnpm prisma:generate`를 먼저 돌린다.

### 검증 진입점

```bash
pnpm job-feed collect              # 수집 → DB
pnpm job-feed collect --dry-run    # DB 미기록
pnpm job-feed collect --explain    # 소스별 3단 계수 + 점수 분포 + 상위 N 내역
pnpm job-feed digest               # 카드 렌더까지 표준출력 (발송 없음)
pnpm job-feed reprocess            # 사전 갱신 후 재파생 + 재채점
```

CLI는 `ConfigModule` + `PrismaModule` + `JobFeedModule`만 올린다. `AppModule` 전체를 부팅하면 실행 중인 서비스의 정기 실행 등록을 건드린다.

`--dry-run`이 필요한 이유: 로컬 DB를 병렬 작업 트리와 공유한다.

`--explain`이 반드시 보여야 하는 것:

- 소스별 원시 수신 / 검증 통과 / 직군 통과
- 점수 분포와 상위 N건 내역
- 프로필 토큰 중 사전 매칭 수, 공고 토큰 중 미매칭 수

마지막 항목이 핵심이다. **점수가 항상 0인 상태가 첫 실행에서 드러나야 한다.** 매칭 코퍼스를 `techTags`로 바꾼 것이 실제로 작동하는지 확인하는 유일한 지표다.

### 반드시 실증할 것

단위 테스트로는 잡히지 않는다.

1. 세 소스에서 실제로 백엔드 공고가 들어오는가 (`--explain`의 직군 통과 건수)
2. 매칭 점수가 0이 아닌 값으로 분포하는가
3. 카드 렌더가 슬랙 마크다운을 깨뜨리지 않는가 — 회사명·제목은 외부 문자열이라 `&`, `<`, `*`가 들어올 수 있다
4. 자동 갭 분석이 `career_target_jd`에 행을 만들지 **않는가**
5. 자동 갭 분석이 대기 카드를 만들지 **않는가**

---

## 7. 구현 순서

1. Prisma 모델 + `db:push` + 생성
2. 도메인 순수 함수 (사전 · 연차 변환 · 지역 변환 · 직군 필터 · 점수 · 중복키) + 테스트
3. 소스 어댑터 3종 (클라이언트 + 매퍼) + 실측 응답 고정 표본 테스트
4. 수집 · 채점 유스케이스 + 원장
5. CLI + `--explain`으로 1~3번 실증
6. 갭 분석 입력 계약 확장 (`origin` · `company` · `role` · `triggerType`)
7. 정기 실행 task 2종 + 등록 4곳 + 플레이북 정합성 테스트
8. 포매터와 카드
9. 환경변수 7곳 + 문서 동기화

---

## 8. 이번 범위 밖

- 잡코리아 · 사람인 (종합 사이트, 본문 파싱 필요)
- 본문에서 기술을 캐내는 모델 기반 추출 — 위 두 소스와 함께
- 만료된 공고 정리 (`lastSeenAt`만 기록해 둔다)
- 웹 화면
- 스킬 카테고리 분류

---

## 9. 알려진 위험과 미해결

| 항목 | 상태 | 대응 |
|---|---|---|
| 랠릿 직군 파라미터 미확정 | 전량 수신 후 코드 필터 | 물량 301건, 감당 가능 |
| 원티드 백엔드 카테고리 ID 미확정 | 광역 카테고리 + 공통 직군 필터 | 구현 중 확정 시도, 실패해도 진행 |
| 소스가 문서화되지 않은 내부 API | 응답 형태 변경 시 3단 계수로 감지 | 고정 표본 테스트로 회귀 확인 |
| 태그에 없는 본문 기술을 놓침 | 1차 한계 | 후속에서 본문 추출 |
| `extractTargetJdIdentity`가 미검증 코드 | 자동 경로는 우회(회사·직무 명시 전달) | 수동 경로는 기존대로 |
| 프로필 갱신 시 기존 점수가 낡음 | `scoredProfileId`로 식별 | `reprocess`로 재채점 |

**BINI에서 가져오지 않기로 한 것**

- 연차 추출 정규식 — 세 소스가 숫자나 열거값을 주므로 불필요하다. 게다가 "경력" 두 글자에 걸리는 규칙이 있어, 숫자가 있는 공고까지 "경력 무관"으로 덮어버린다.
- 지역 문자열 포함 검사 — 랠릿·원티드가 영문 코드를 주므로 한글 시도명과 겹치지 않는다. 대응표를 새로 만든다.

**BINI에서 가져오는 것**

- 소스 격리 방식(한 곳이 실패해도 나머지 진행, 실패 소스를 결과에 노출)
- 회사명+제목 정규화 중복 제거
- 상세 수집 예산 제어(호출 상한 · 간격 · 재수집 기준 시간)
