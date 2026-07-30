import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { GithubClientPort } from '../../github/domain/port/github-client.port';
import type { CreatePreviewUsecase } from '../../preview-gate/application/create-preview.usecase';
import type { FindAllOpenPreviewsUsecase } from '../../preview-gate/application/find-all-open-previews.usecase';
import {
  PREVIEW_KIND,
  type PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { DispatchCooldown } from './dispatch-cooldown';
import { SessionDispatchService } from './session-dispatch.service';

const CLAUDE_SESSION = {
  sessionId: 's1',
  source: 'claude' as const,
  cwd: '/work/career-mate',
  name: 'career-mate',
};

const OPEN_PULL_REQUEST = {
  number: 7,
  title: '자동 분배',
  body: '본문',
  repo: 'me/career-mate',
  url: 'https://github.com/me/career-mate/pull/7',
  state: 'open' as const,
  mergedAt: null,
  updatedAt: '2026-07-30T00:00:00.000Z',
  additions: 10,
  deletions: 2,
  changedFilesCount: 1,
};

function makeOpenPreview(payload: unknown): PreviewAction {
  return {
    id: 'preview-1',
    slackUserId: 'U-owner',
    kind: PREVIEW_KIND.SESSION_INJECT,
    payload,
    status: 'PENDING',
    previewText: '열린 제안',
    responseUrl: null,
    expiresAt: new Date('2026-07-30T01:00:00.000Z'),
    createdAt: new Date('2026-07-30T00:00:00.000Z'),
    appliedAt: null,
    cancelledAt: null,
    slackChannelId: null,
    slackMessageTs: null,
  };
}

function make(overrides: Partial<Record<string, unknown>> = {}) {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | undefined> = {
        SESSION_DISPATCH_ENABLED: 'true',
        AUTOPILOT_OWNER_SLACK_USER_ID: 'U-owner',
        IMPACT_REPORT_GITHUB_AUTHOR: 'me',
        ...(overrides.config as Record<string, string | undefined>),
      };
      return values[key];
    }),
  };
  const githubClient = {
    listAuthorOpenPullRequests: jest
      .fn()
      .mockResolvedValue([OPEN_PULL_REQUEST]),
  };
  const createPreview = {
    execute: jest.fn().mockResolvedValue(makeOpenPreview({})),
  };
  const findOpen = { execute: jest.fn().mockResolvedValue([]) };
  const cooldown = {
    shouldSkip: jest.fn().mockReturnValue(false),
    mark: jest.fn(),
  };
  const service = new SessionDispatchService(
    config as unknown as ConfigService,
    githubClient as unknown as GithubClientPort,
    createPreview as unknown as CreatePreviewUsecase,
    findOpen as unknown as FindAllOpenPreviewsUsecase,
    cooldown as unknown as DispatchCooldown,
  );

  return { config, createPreview, cooldown, findOpen, githubClient, service };
}

describe('SessionDispatchService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Claude idle 세션의 열린 PR을 SESSION_INJECT 제안으로 만들고 cooldown을 기록한다', async () => {
    const { createPreview, cooldown, githubClient, service } = make();

    await service.onSessionBecameIdle(CLAUDE_SESSION);

    expect(createPreview.execute).toHaveBeenCalledWith({
      slackUserId: 'U-owner',
      kind: PREVIEW_KIND.SESSION_INJECT,
      payload: {
        sessionId: 's1',
        source: 'claude',
        instruction:
          '열린 PR me/career-mate#7 를 리뷰해 줘. 변경 파일을 확인하고, 버그·설계·테스트 관점의 개선점을 정리한 뒤 필요한 수정을 제안해 줘.',
        prRef: 'me/career-mate#7',
      },
      previewText:
        '세션 career-mate(career-mate)가 유휴 상태입니다. PR me/career-mate#7 리뷰를 맡길까요?',
      responseUrl: null,
      ttlMs: 30 * 60 * 1000,
    });
    expect(githubClient.listAuthorOpenPullRequests).toHaveBeenCalledWith({
      repo: 'me/career-mate',
      author: 'me',
      sinceIsoDate: expect.any(String),
      limit: 1,
    });
    expect(cooldown.mark).toHaveBeenCalledWith('s1');
  });

  it('SESSION_DISPATCH_ENABLED가 true가 아니면 제안을 만들지 않는다', async () => {
    const { createPreview, service } = make({
      config: { SESSION_DISPATCH_ENABLED: 'false' },
    });

    await service.onSessionBecameIdle(CLAUDE_SESSION);

    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('owner가 없으면 기본 비활성으로 제안을 만들지 않는다', async () => {
    const { createPreview, service } = make({
      config: { AUTOPILOT_OWNER_SLACK_USER_ID: undefined },
    });

    await service.onSessionBecameIdle(CLAUDE_SESSION);

    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('GitHub author가 없으면 제안을 만들지 않는다', async () => {
    const { createPreview, githubClient, service } = make({
      config: { IMPACT_REPORT_GITHUB_AUTHOR: undefined },
    });

    await service.onSessionBecameIdle(CLAUDE_SESSION);

    expect(githubClient.listAuthorOpenPullRequests).not.toHaveBeenCalled();
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('codex 세션에는 v1 제안을 만들지 않는다', async () => {
    const { createPreview, service } = make();

    await service.onSessionBecameIdle({ ...CLAUDE_SESSION, source: 'codex' });

    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('cooldown 안의 세션에는 제안을 만들지 않는다', async () => {
    const { createPreview, cooldown, service } = make();
    cooldown.shouldSkip.mockReturnValue(true);

    await service.onSessionBecameIdle(CLAUDE_SESSION);

    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('같은 세션의 열린 SESSION_INJECT 제안이 있으면 중복 생성하지 않는다', async () => {
    const { createPreview, findOpen, service } = make();
    findOpen.execute.mockResolvedValue([
      makeOpenPreview({ sessionId: 's1', source: 'claude' }),
    ]);

    await service.onSessionBecameIdle(CLAUDE_SESSION);

    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('잘못된 열린 SESSION_INJECT payload는 정상 제안 생성을 막지 않는다', async () => {
    const { createPreview, findOpen, service } = make();
    findOpen.execute.mockResolvedValue([
      makeOpenPreview(null),
      makeOpenPreview('invalid payload'),
    ]);

    await service.onSessionBecameIdle(CLAUDE_SESSION);

    expect(createPreview.execute).toHaveBeenCalledTimes(1);
  });

  it('열린 PR이 없으면 제안을 만들지 않는다', async () => {
    const { createPreview, githubClient, service } = make();
    githubClient.listAuthorOpenPullRequests.mockResolvedValue([]);

    await service.onSessionBecameIdle(CLAUDE_SESSION);

    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('제안 생성 실패를 삼키고 cooldown을 기록하지 않는다', async () => {
    const { cooldown, createPreview, service } = make();
    createPreview.execute.mockRejectedValue(new Error('preview write failed'));

    await expect(
      service.onSessionBecameIdle(CLAUDE_SESSION),
    ).resolves.toBeUndefined();

    expect(cooldown.mark).not.toHaveBeenCalled();
  });
});
