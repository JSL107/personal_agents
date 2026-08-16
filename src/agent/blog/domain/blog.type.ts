export interface GenerateBlogDraftInput {
  requestText: string;
  slackUserId: string;
}

// 노션 초안 → GitHub 파일 발행 승인 카드 payload. Astro post 조립 결과(path/content)는 카드 생성
// 시점에 고정하고, 승인 후 applier 는 이 값 그대로 한 번만 main 에 커밋한다.
export interface BlogGithubPublishPayload {
  pageId: string;
  path: string;
  content: string;
  title: string;
  notionUrl: string;
  tags: string[];
  summary: string;
  slackUserId: string;
}

export const isBlogGithubPublishPayload = (
  payload: unknown,
): payload is BlogGithubPublishPayload => {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const candidate = payload as Partial<BlogGithubPublishPayload>;
  return (
    typeof candidate.pageId === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.notionUrl === 'string' &&
    Array.isArray(candidate.tags) &&
    candidate.tags.every((tag) => typeof tag === 'string') &&
    typeof candidate.summary === 'string' &&
    typeof candidate.slackUserId === 'string'
  );
};

export interface PublishNotionDraftInput {
  slackUserId: string;
  titleQuery?: string;
  // failure replay는 최초 실행이 선택한 같은 Notion page를 우선한다.
  pageId?: string;
  responseUrl?: string | null;
  triggerType?: import('../../../agent-run/domain/agent-run.type').TriggerType;
}

export type PublishNotionDraftResult =
  | { status: 'empty'; message: string }
  | {
      status: 'blocked';
      message: string;
      hits: Array<{ term: string; kind: 'term' | 'pattern'; excerpt: string }>;
    }
  | {
      status: 'preview';
      previewId: string;
      previewText: string;
      title: string;
      notionUrl: string;
      path: string;
      content: string;
    };

// Hermes 실행 결과에서 추출한 초안 정보.
export interface BlogDraftResult {
  notionUrl: string;
  // Hermes stdout 최종 블록(요약/제목 등) — 포맷터/디버깅에 사용.
  rawOutput: string;
  // Notion 페이지를 발행 상태(상태=발행 등)로 enrich 성공했는지. 실패해도 초안 URL 은 회신.
  published: boolean;
  /** Hermes 가 낸 2~3문장 요약. 마커가 없으면 미설정. */
  summary?: string;
  /**
   * `published === false` 인 **이유**. 발행을 시도했다가 실패한 경우에만 채워진다.
   *
   * 이게 없으면 "속성 갱신이 실패했다" 와 "발행할 대상 자체가 없었다" 가 똑같이
   * `published: false` 로 보여서, 사용자에게는 정상 초안 생성처럼 읽힌다. 실측
   * (2026-06) BLOG 성공 4건이 전부 `published: false` 였는데 warn 로그로만 남아
   * 아무도 실패인 줄 몰랐다 — 저녁 경로가 #153 에서 같은 이유로 고친 것과 같은 처리.
   */
  publishError?: string;
}
