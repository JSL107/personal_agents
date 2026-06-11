// 이대리 → Hermes `hermes -z` 에 넘길 프롬프트를 구성한다.
// - tistory-blog 스킬을 **명시 호출**(평범한 요청은 oneshot 에이전트가 스킬을 자동 트리거하지 않음).
// - Slack 알림은 요청하지 않는다 — 이대리가 stdout 의 URL 로 직접 답장하고 Hermes DM 은 끈다(BLOG_NOTIFY_SLACK=0).
// - 마지막 줄에 `NOTION_URL: <url>` 출력을 강제해 추출 안정성 확보.
export const buildBlogPrompt = (requestText: string): string =>
  [
    'tistory-blog 스킬을 사용해라.',
    '아래 요청으로 블로그 초안을 스킬 지침(references/voice.md 말투, templates.md 템플릿)대로 작성하고,',
    "반드시 create_notion_draft.py 로 '블로그 초안' Notion DB 에 페이지를 만들어라.",
    "완료 후 생성된 Notion 페이지 URL 을 마지막 줄에 정확히 'NOTION_URL: <url>' 형식으로 출력해라.",
    '',
    `요청: ${requestText}`,
  ].join('\n');
