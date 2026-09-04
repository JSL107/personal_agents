// 외부 연동(Slack · Notion · GitHub) 실패 → "그래서 뭘 하면 되는지" 한 줄 사전.
//
// 차단 사유 사전(`block-reason.ts`)과 무엇이 다른가.
//   - 차단 사유는 **우리가** 스스로 멈춘 이유(쿼터·미연동·선행 부재)를 한국어 문구로 판정한다.
//   - 여기는 **외부 서비스가 준 코드**(Slack `channel_not_found`, Notion `object_not_found`,
//     GitHub 404)를 한국어 행동으로 옮긴다. 키가 코드라 문구가 바뀌어도 안 흔들린다.
// 그래서 둘을 한 사전에 합치지 않는다 — 키 공간이 다르고, 합치면 문자열 판정이 코드 판정을
// 오염시킨다.
//
// 사전은 "다음 행동" 만 든다. 원인 문구는 호출부가 이미 들고 있다
// (`Notion page ... 조회 실패: Could not find page with ID ...`).
//
// 실측 출처 — 추측으로 넣은 항목은 없다.
//   - Slack `channel_not_found`: 실제 사고 기록
//     `docs/superpowers/archive/2026-08-27-job-feed-sdd/NEXT-SESSION-PROMPT.md:40`
//     (봇과 워크스페이스가 달라 채널을 못 찾음)
//   - Slack `not_in_channel`: `src/slack/slack.service.ts` postMessage 주석
//     ("private 채널이면 봇이 invite 돼 있어야 함") + `slack-web-api.collector.spec.ts:83`
//   - Notion 코드 목록: `@notionhq/client` 의 `APIErrorCode` enum (설치본 실측)
//   - GitHub status/`RequestError`: `@octokit/request-error` 의 `status: number` (설치본 실측)
//
// 일부러 뺀 것 — GitHub 422. 기존 파일·브랜치 충돌, branch protection, 줄 앵커 거부가 전부
// 같은 422 라 한 줄로 옮길 행동이 없다(`octokit-github.client.ts:1206`,
// `github-client.port.ts:132`·`:224`). 알아보는 422 는 이미 그 자리에서 전용 문구로
// 바뀌므로, 남는 422 에 뭉뚱그린 조치를 붙이면 틀린 방향을 가리킨다.
//
// 여기 없는 코드는 힌트를 붙이지 않는다. 모르는 실패에 아는 척하는 조치를 붙이는 쪽이 더 나쁘다.

const SLACK_HINTS: Readonly<Record<string, string>> = {
  channel_not_found:
    '채널 ID 가 없거나 봇이 그 워크스페이스에 없습니다 — `.env` 의 채널 ID 와 앱 설치 워크스페이스를 확인하세요.',
  not_in_channel:
    '봇이 그 채널에 없습니다 — 채널에서 `/invite @이대리` 로 초대하세요.',
  is_archived:
    '보관된 채널입니다 — 채널을 되살리거나 `.env` 의 채널 ID 를 살아 있는 채널로 바꾸세요.',
  invalid_auth:
    '봇 토큰이 유효하지 않습니다 — `SLACK_BOT_TOKEN` 을 재발급해 `.env` 에 넣으세요.',
  token_revoked:
    '봇 토큰이 회수됐습니다 — 앱을 다시 설치하고 `SLACK_BOT_TOKEN` 을 재발급하세요.',
  account_inactive:
    '봇 계정이 비활성 상태입니다 — 워크스페이스에서 앱을 다시 설치하세요.',
  ratelimited: 'Slack 호출 한도에 걸렸습니다 — 잠시 후 다시 시도하세요.',
};

const NOTION_HINTS: Readonly<Record<string, string>> = {
  object_not_found:
    '페이지·DB 를 못 찾습니다 — Notion 에서 해당 페이지의 `연결(Connections)` 에 이대리 통합을 추가했는지, `.env` 의 ID 가 맞는지 확인하세요.',
  unauthorized:
    'Notion 토큰이 유효하지 않습니다 — `NOTION_TOKEN` 을 재발급해 `.env` 에 넣으세요.',
  restricted_resource:
    '통합에 그 작업 권한이 없습니다 — Notion 통합 설정에서 읽기/쓰기 권한을 켜세요.',
  // 블로그 DB 뿐 아니라 block append·속성 갱신 등 모든 쓰기가 이 코드를 낸다.
  // 그래서 특정 설정 키를 지목하지 않고, Notion 이 원문에서 짚어 준 필드를 보라고 한다.
  validation_error:
    '보낸 값을 Notion 이 거절했습니다 — 원문이 지목한 필드를 보고 속성 이름·타입이 실제 DB 스키마와 같은지 확인하세요.',
  rate_limited: 'Notion 호출 한도에 걸렸습니다 — 잠시 후 다시 시도하세요.',
  conflict_error:
    '같은 페이지를 동시에 고쳐 충돌했습니다 — 다시 시도하면 대개 통과합니다.',
  service_unavailable:
    'Notion 이 일시적으로 응답하지 않습니다 — 잠시 후 다시 시도하세요.',
};

// GitHub 은 코드가 아니라 HTTP status 로 온다(`RequestError.status`).
const GITHUB_HINTS: Readonly<Record<number, string>> = {
  401: 'GitHub 토큰이 유효하지 않습니다 — `GITHUB_TOKEN` 을 재발급해 `.env` 에 넣으세요.',
  404: '레포·PR 을 못 찾습니다 — 이름·번호가 맞는지, private 레포면 토큰에 `repo` scope 가 있는지 확인하세요.',
  429: 'GitHub 호출 한도에 걸렸습니다 — 잠시 후 다시 시도하세요.',
};

const GITHUB_FORBIDDEN_PERMISSION_HINT =
  '그 작업 권한이 없습니다 — 토큰 scope(`repo`) 와 레포 접근 권한을 확인하세요.';
const GITHUB_FORBIDDEN_RATE_LIMIT_HINT =
  'GitHub 호출 한도를 다 썼습니다 — 한도가 리셋되면 다시 시도하세요.';

const readString = (source: unknown, key: string): string | null => {
  if (!source || typeof source !== 'object' || !(key in source)) {
    return null;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
};

// Slack WebAPI 의 platform error 는 코드를 `data.error` 에 담는다
// (`@slack/web-api` 의 `WebAPIPlatformError`).
const describeSlackFailure = (error: unknown): string | null => {
  if (!error || typeof error !== 'object' || !('data' in error)) {
    return null;
  }
  const code = readString((error as { data: unknown }).data, 'error');
  return code === null ? null : (SLACK_HINTS[code] ?? null);
};

const describeNotionFailure = (error: unknown): string | null => {
  const code = readString(error, 'code');
  return code === null ? null : (NOTION_HINTS[code] ?? null);
};

// 403 은 권한 부족과 한도 소진 둘 다 쓴다 — 행동이 정반대라("권한을 주세요" vs "기다리세요")
// 응답 헤더의 남은 호출 수로 가른다. 헤더가 없으면 권한 쪽으로 답한다(한도 소진이면
// GitHub 이 거의 항상 헤더를 준다).
const describeGithubForbidden = (error: unknown): string => {
  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== 'object' || !('headers' in response)) {
    return GITHUB_FORBIDDEN_PERMISSION_HINT;
  }
  const remaining = readString(
    (response as { headers: unknown }).headers,
    'x-ratelimit-remaining',
  );
  return remaining === '0'
    ? GITHUB_FORBIDDEN_RATE_LIMIT_HINT
    : GITHUB_FORBIDDEN_PERMISSION_HINT;
};

// Octokit 의 `RequestError` 는 name 이 'HttpError' 이고 status 를 숫자로 든다.
// status 만 보고 판정하면 같은 이름의 필드를 가진 우리 DomainException(`status: DomainStatus`)
// 까지 GitHub 실패로 오인한다 — name 을 함께 본다.
const describeGithubFailure = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') {
    return null;
  }
  if (readString(error, 'name') !== 'HttpError') {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  if (typeof status !== 'number') {
    return null;
  }
  if (status === 403) {
    return describeGithubForbidden(error);
  }
  return GITHUB_HINTS[status] ?? null;
};

// 알아본 실패면 "다음 행동" 한 줄, 아니면 null.
export const describeIntegrationFailure = (error: unknown): string | null => {
  return (
    describeSlackFailure(error) ??
    describeNotionFailure(error) ??
    describeGithubFailure(error)
  );
};

// 원인 문구 뒤에 "다음 행동" 을 한 줄 붙인다. 못 알아보면 원문 그대로.
// 이미 같은 문장이 들어 있으면 다시 붙이지 않는다 — 한 카드에서 같은 안내가 두 번 나오면
// 읽는 사람이 두 가지 조치로 오해한다(`block-reason.ts` 의 `statesRecoveryAlready` 와 같은 이유).
export const appendIntegrationHint = (
  message: string,
  error: unknown,
): string => {
  const hint = describeIntegrationFailure(error);
  if (hint === null || message.includes(hint)) {
    return message;
  }
  return `${message} ${hint}`;
};
