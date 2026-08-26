import { MarkdownStructureCounts } from '../../../humanize/domain/markdown-blocks';

// 단계 경계 계측 — 파이프라인 각 단계가 무엇을 남기고 무엇을 덜어냈는지.
//
// 왜 재는가: 편집 과삭제 가드는 글자 수 비율만 본다(`assertNotOverTrimmed`). 실측된 발행본은
// 그 가드를 60.45% 로 통과하면서 인용 7줄과 헤딩 9개를 잃었다 — 200자 남짓이라 문자 게이트에
// 잡히지 않는다. 어느 단계가 지웠는지도 사후에 알 수 없었다(익명화 산출물을 아무도 세지 않는다).
// 그래서 차단이 아니라 관측이다: 단계마다 세어 승인 카드와 원장에 남긴다.
export type BlogStageName = '원문' | '익명화' | '편집' | '최종';

export type BlogStageStructure = MarkdownStructureCounts & {
  stage: BlogStageName;
};

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

export type BlogPublishCandidate =
  | { status: 'empty'; message: string }
  // 이번 저녁은 발행하지 않는다. cause 로 두 경우를 구분한다 —
  // 'hold': 편집 단계가 발행 부적합으로 판정해 Notion 초안을 보류로 옮겼다(사용자에게 알린다).
  // 'card-open': 아직 응답하지 않은 발행 카드가 열려 있다(이미 카드가 보이므로 조용히 넘긴다).
  | { status: 'skipped'; cause: 'hold' | 'card-open'; message: string }
  | {
      status: 'blocked';
      message: string;
      hits: Array<{ term: string; kind: 'term' | 'pattern'; excerpt: string }>;
    }
  | {
      status: 'ready';
      payload: BlogGithubPublishPayload;
      previewText: string;
      title: string;
      notionUrl: string;
      path: string;
      content: string;
    };

export type PublishNotionDraftResult =
  | { status: 'empty'; message: string }
  | { status: 'skipped'; cause: 'hold' | 'card-open'; message: string }
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

// 원장 output — 결과에 단계 수치만 얹는다. **본문은 담지 않는다**(윤문 경로가 세운 규약):
// 단계별 본문을 담으면 원장이 같은 글 네 벌로 부푼다.
//
// 발행 경로가 둘이라 한 자리에 둔다 — 수동 `/blog-publish` 는 usecase 의 `execute` 가, 저녁
// cron 은 autopilot task 가 각자 AgentRun 을 연다. 한쪽에만 넣으면 **정작 매일 도는 쪽이**
// 빠진다.
//
// 도달한 단계가 없으면 키를 만들지 않는다: 빈 배열을 남기면 '재지 않았다' 와 '0 이었다' 가
// 같은 값이 되어, 원장을 훑는 쪽이 계측 누락을 손실로 읽는다.
export const buildBlogRunOutput = (
  result: PublishNotionDraftResult | BlogPublishCandidate,
  stages: readonly BlogStageStructure[],
): Record<string, unknown> => {
  return stages.length === 0 ? { ...result } : { ...result, stages };
};
