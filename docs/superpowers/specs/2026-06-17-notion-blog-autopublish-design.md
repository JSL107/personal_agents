# Notion 기술 블로그 자동 발행 — 설계

**날짜**: 2026-06-17 · **상태**: 설계 리뷰 대기

## 배경
이대리 BLOG 에이전트는 `@이대리 ...블로그 써줘` → Hermes `tistory-blog` 스킬이 리서치 후 **Notion '블로그 초안' DB에 페이지 생성** → 이대리가 `NOTION_URL` 만 회신받는다(`GenerateBlogDraftUsecase`). Tistory 공식 글쓰기 Open API는 2024.2 종료라 자동 발행 경로가 없다. **Notion은 완전한 API가 있으므로 Notion 자체를 블로그 플랫폼으로** 삼아 완전 자동 발행 루프를 만든다.

## 결정 기록 (2026-06-17 사용자 확정)
- 발행 타깃 = **Notion** (Tistory 아님 — API 종료).
- 방식 = **post-publish enrich**: Hermes는 본문 생성 그대로, 이대리가 생성된 페이지를 "발행 가능 상태"로 보강.
- **완전 자동** (PreviewGate 게이트 없음). 발행=공개지만 Notion 상태를 되돌리면 비공개라 가역.
- 메타(태그/요약)는 **별도 LLM 콜 없이 Hermes 출력 라인**(`TAGS:`/`SUMMARY:`)으로 받음 — 신규 AgentType·route() 불필요.

## Part A — Notion 셋업 (사용자, 1회, 코드 없음)
'블로그 초안' DB(또는 '기술 블로그'로 rename)에 속성 추가 — **이름이 코드 상수와 정확히 일치해야 함**:
- `상태` (Select: 옵션 `초안`, `발행`)
- `발행일` (Date)
- `태그` (Multi-select)
- `요약` (Text / rich_text)
- (`제목`은 기존 title 속성, 커버는 페이지 cover — 선택)

공개: **Gallery view** 생성 → 필터 `상태 = 발행`, 정렬 `발행일 ↓` → 그 view를 "웹에 게시(Share → 웹에 게시)". (Lv2 선택: Oopy/Super.so로 커스텀 도메인+SEO.)

> Integration(Notion API token)이 이 DB에 접근 권한이 있어야 함(기존 NotionClient 토큰 재사용 — 이미 다른 DB 적재 중이라 토큰 존재).

## Part B — 이대리 코드 (in-repo)

### B1. NotionClient 속성 업데이트 기능
`src/notion/domain/port/notion-client.port.ts`:
```ts
export interface UpdatePagePropertiesOptions {
  pageId: string;
  // Notion API properties payload (호출부가 한글 속성명으로 구성). 형태는 client가 그대로 전달.
  properties: Record<string, unknown>;
}
// NotionClientPort 에 추가:
updatePageProperties(options: UpdatePagePropertiesOptions): Promise<void>;
```
`src/notion/infrastructure/notion-api.client.ts` — `appendBlocks` 패턴 그대로(assertClientConfigured + try/catch → NotionException):
```ts
async updatePageProperties({ pageId, properties }: UpdatePagePropertiesOptions): Promise<void> {
  this.assertClientConfigured('updatePageProperties');
  try {
    await this.client!.pages.update({
      page_id: pageId,
      properties: properties as Parameters<Client['pages']['update']>[0]['properties'],
    });
  } catch (error: unknown) {
    throw new NotionException({ code: NotionErrorCode.REQUEST_FAILED, message: `Notion page ${pageId} 속성 업데이트 실패: ...`, cause: error });
  }
}
```

### B2. Hermes 프롬프트에 메타 출력 요청
`src/agent/blog/application/build-blog-prompt.ts` — `NOTION_URL:` 요청에 더해:
- "마지막 줄들에 `TAGS: 태그1, 태그2, 태그3`(3~5개, 기술 키워드) 와 `SUMMARY: <2~3문장 요약>` 도 정확히 출력해라."

### B3. 메타/페이지ID 파서
`src/agent/blog/application/extract-blog-metadata.ts` (extract-notion-url 패턴):
- `extractTags(stdout): string[]` — `TAGS:` 마커 라인 파싱(콤마 split, trim, 빈값 제거, 최대 5). 없으면 `[]`.
- `extractSummary(stdout): string | null` — `SUMMARY:` 마커.
- `notionPageIdFromUrl(url): string | null` — URL 끝의 32-hex(하이픈 유무 무관) 추출.

### B4. GenerateBlogDraftUsecase enrich
- 생성자에 `@Inject(NOTION_CLIENT_PORT) notionClient` 추가.
- `run()` 에서 notionUrl 확보 후:
  ```ts
  const pageId = notionPageIdFromUrl(notionUrl);
  if (pageId) {
    try {
      await this.notionClient.updatePageProperties({
        pageId,
        properties: buildBlogPublishProperties({ tags: extractTags(stdout), summary: extractSummary(stdout), publishedAt: todayKstIso() }),
      });
    } catch (error) { /* best-effort: 로그만, 초안 URL 은 그대로 회신 */ }
  }
  ```
- `buildBlogPublishProperties` (도메인 헬퍼): 한글 속성명으로 Notion properties payload 구성 — `상태`(select `발행`), `발행일`(date), `태그`(multi_select), `요약`(rich_text). 빈 태그/요약은 생략.
- 속성명 상수: `BLOG_PROP = { status:'상태', publishedAt:'발행일', tags:'태그', summary:'요약' } as const`, `BLOG_STATUS_PUBLISHED = '발행'`.
- BlogDraftResult 에 `published: boolean`(enrich 성공 여부) 추가 — formatter가 "발행됨/초안" 구분 표기 가능.

### B5. 모듈 배선
- `BlogModule`(`src/agent/blog/blog.module.ts`)에 NotionModule import + NOTION_CLIENT_PORT 주입 가능하게.

## 에러/리스크
- **enrich best-effort**: 속성 업데이트 실패(DB 속성 미설정/권한)해도 throw 안 함 — 초안 URL 회신 + 로그 warn. (사용자가 Part A 안 했어도 블로그 초안 기능은 기존대로 동작.)
- 발행=공개. 완전자동(요청). Notion 상태 되돌리면 비공개.
- Hermes가 `TAGS:`/`SUMMARY:` 안 주면 → 태그/요약 생략, 상태=발행·발행일만 set (graceful).

## 테스트
- `notion-api.client` updatePageProperties: pages.update 호출 인자 검증, 실패 시 NotionException.
- `extract-blog-metadata`: TAGS/SUMMARY 파싱, pageId 추출(하이픈 유무), 마커 부재 시 빈/ null.
- `generate-blog-draft.usecase`: notionUrl 후 updatePageProperties 호출(상태=발행) 검증; enrich 실패해도 result 회신(best-effort); pageId 파싱 실패 시 enrich skip.
- 게이트: lint:check 0 / build 0 / test green.

## 비범위
- Oopy/Super 도메인·SEO(사용자 Part A Lv2), Tistory 발행(API 종료), 메타 별도 LLM 콜(Hermes 출력으로 대체), Notion DB 스키마 자동 생성(사용자 수동).

## 사용자 액션 (배포 후)
Part A(Notion DB 속성 4종 + 공개 Gallery view) 1회 셋업. 안 하면 enrich는 graceful 무동작(초안 기능은 정상).
