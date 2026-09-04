import { classifyBlockReason } from './block-reason';
import {
  appendIntegrationHint,
  describeIntegrationFailure,
} from './integration-failure-hint';

// Slack WebAPI 의 platform error 모양 — 코드는 `data.error` 에 온다.
const slackError = (code: string): unknown => {
  const error = new Error(`An API error occurred: ${code}`);
  return Object.assign(error, {
    code: 'slack_webapi_platform_error',
    data: { ok: false, error: code },
  });
};

// Notion SDK 의 APIResponseError 모양 — 코드는 `code` 에 온다.
const notionError = (code: string): unknown => {
  const error = new Error('Notion 이 준 원문 메시지');
  return Object.assign(error, { code, status: 404 });
};

// Octokit 의 RequestError 모양 — name 이 'HttpError' 이고 status 는 숫자.
const githubError = (status: number, headers?: Record<string, string>) => {
  const error = new Error('Not Found');
  return Object.assign(error, {
    name: 'HttpError',
    status,
    ...(headers ? { response: { headers } } : {}),
  });
};

describe('describeIntegrationFailure', () => {
  it('Slack 채널을 못 찾으면 채널 ID·워크스페이스를 확인하라고 답한다', () => {
    expect(
      describeIntegrationFailure(slackError('channel_not_found')),
    ).toContain('앱 설치 워크스페이스');
  });

  it('Slack 봇 미초대는 /invite 를 지목한다', () => {
    expect(describeIntegrationFailure(slackError('not_in_channel'))).toContain(
      '/invite @이대리',
    );
  });

  it('Notion object_not_found 는 통합 연결을 지목한다', () => {
    expect(
      describeIntegrationFailure(notionError('object_not_found')),
    ).toContain('연결(Connections)');
  });

  it('Notion validation_error 는 원문이 지목한 필드를 보라고 답한다', () => {
    expect(
      describeIntegrationFailure(notionError('validation_error')),
    ).toContain('원문이 지목한 필드');
  });

  // 422 는 기존 파일 충돌 · branch protection · 줄 앵커 거부가 전부 같은 코드라
  // 한 줄로 옮길 행동이 없다 — 뭉뚱그린 조치를 붙이지 않는 쪽을 택했다.
  it('GitHub 422 에는 힌트를 붙이지 않는다', () => {
    expect(describeIntegrationFailure(githubError(422))).toBeNull();
  });

  it('GitHub 404 는 이름·번호와 repo scope 를 지목한다', () => {
    expect(describeIntegrationFailure(githubError(404))).toContain('repo');
  });

  // 403 은 행동이 정반대라 갈라야 한다.
  it('GitHub 403 은 남은 호출 수가 0 이면 한도 소진으로 답한다', () => {
    const hint = describeIntegrationFailure(
      githubError(403, { 'x-ratelimit-remaining': '0' }),
    );
    expect(hint).toContain('한도');
    expect(hint).not.toContain('scope');
  });

  it('GitHub 403 은 한도가 남아 있으면 권한 부족으로 답한다', () => {
    const hint = describeIntegrationFailure(
      githubError(403, { 'x-ratelimit-remaining': '4980' }),
    );
    expect(hint).toContain('scope');
  });

  // 우리 DomainException 도 `status` 를 든다 — name 을 안 보면 GitHub 실패로 오인한다.
  it('status 만 같은 우리 예외는 GitHub 실패로 보지 않는다', () => {
    const ours = Object.assign(new Error('선행 산출물이 없습니다'), {
      name: 'CtoException',
      status: 404,
    });
    expect(describeIntegrationFailure(ours)).toBeNull();
  });

  it('모르는 코드에는 아무 힌트도 붙이지 않는다', () => {
    expect(describeIntegrationFailure(slackError('some_new_code'))).toBeNull();
    expect(describeIntegrationFailure(notionError('teapot'))).toBeNull();
    expect(describeIntegrationFailure(githubError(500))).toBeNull();
    expect(describeIntegrationFailure(new Error('그냥 실패'))).toBeNull();
    expect(describeIntegrationFailure(null)).toBeNull();
  });
});

describe('appendIntegrationHint', () => {
  it('원인 문구 뒤에 행동 한 줄을 붙인다', () => {
    const message = appendIntegrationHint(
      'Notion page abc 조회 실패: Could not find page',
      notionError('object_not_found'),
    );
    expect(message).toContain('Notion page abc 조회 실패: Could not find page');
    expect(message).toContain('연결(Connections)');
  });

  it('못 알아본 실패는 원문 그대로 둔다', () => {
    const original = 'Notion page abc 조회 실패: 알 수 없는 오류';
    expect(appendIntegrationHint(original, new Error('x'))).toBe(original);
  });

  it('같은 안내가 이미 있으면 두 번 붙이지 않는다', () => {
    const once = appendIntegrationHint(
      '조회 실패',
      notionError('object_not_found'),
    );
    expect(appendIntegrationHint(once, notionError('object_not_found'))).toBe(
      once,
    );
  });
});

// 차단 사유 사전(`block-reason.ts`)은 한국어 **문구**로 판정한다. 여기서 붙이는 힌트도
// 한국어라, 문구가 그쪽 신호와 겹치면 실패 카드에 엉뚱한 원인이 하나 더 붙는다
// (예: `.env` + `설정되지 않` 이 함께 있으면 미연동으로 잡힌다).
// 지금은 안 겹치지만 힌트를 새로 쓸 때 조용히 깨질 자리라 여기서 못 박는다.
describe('차단 사유 사전과 겹치지 않는다', () => {
  const hintOnly = (error: unknown): string => {
    const hint = describeIntegrationFailure(error);
    expect(hint).not.toBeNull();
    return hint as string;
  };

  it.each([
    ['slack channel_not_found', slackError('channel_not_found')],
    ['slack not_in_channel', slackError('not_in_channel')],
    ['slack is_archived', slackError('is_archived')],
    ['slack invalid_auth', slackError('invalid_auth')],
    ['slack token_revoked', slackError('token_revoked')],
    ['slack account_inactive', slackError('account_inactive')],
    ['slack ratelimited', slackError('ratelimited')],
    ['notion object_not_found', notionError('object_not_found')],
    ['notion unauthorized', notionError('unauthorized')],
    ['notion restricted_resource', notionError('restricted_resource')],
    ['notion validation_error', notionError('validation_error')],
    ['notion rate_limited', notionError('rate_limited')],
    ['notion conflict_error', notionError('conflict_error')],
    ['notion service_unavailable', notionError('service_unavailable')],
    ['github 401', githubError(401)],
    ['github 404', githubError(404)],
    ['github 429', githubError(429)],
    ['github 403 권한', githubError(403, { 'x-ratelimit-remaining': '9' })],
    ['github 403 한도', githubError(403, { 'x-ratelimit-remaining': '0' })],
  ])('%s 힌트는 차단 사유로 잡히지 않는다', (_label, error) => {
    expect(classifyBlockReason(hintOnly(error))).toBeNull();
  });
});
