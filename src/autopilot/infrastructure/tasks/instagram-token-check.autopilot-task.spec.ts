import { InstagramException } from '../../../instagram/domain/instagram.exception';
import { InstagramErrorCode } from '../../../instagram/domain/instagram-error-code.enum';
import {
  MetaGraphPort,
  PageTokenDebug,
} from '../../../instagram/domain/port/meta-graph.port';
import { InstagramTokenCheckAutopilotTask } from './instagram-token-check.autopilot-task';

const now = new Date('2026-11-05T00:00:00Z');

const buildGraph = (overrides: Partial<PageTokenDebug> = {}): MetaGraphPort =>
  ({
    isConfigured: jest.fn().mockReturnValue(true),
    debugPageToken: jest.fn().mockResolvedValue({
      isValid: true,
      expiresAt: 0,
      dataAccessExpiresAt: Math.floor(now.getTime() / 1000) + 90 * 86400,
      scopes: ['instagram_content_publish'],
      ...overrides,
    }),
  }) as unknown as MetaGraphPort;

describe('InstagramTokenCheckAutopilotTask', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  it('정상 토큰이 90일 남으면 skip 한다', async () => {
    const task = new InstagramTokenCheckAutopilotTask(buildGraph());
    await expect(task.run()).resolves.toEqual({ skip: true });
  });

  it('토큰 재동의가 13일 남으면 D-13을 안내한다', async () => {
    const graph = buildGraph({
      dataAccessExpiresAt: Math.floor(now.getTime() / 1000) + 13 * 86400,
    });
    const task = new InstagramTokenCheckAutopilotTask(graph);
    await expect(task.run()).resolves.toMatchObject({
      skip: false,
      summaryText:
        '⏳ 인스타 토큰 재동의 D-13 (2026-11-18). README 「인스타 토큰 재동의」 절을 따라 갱신해 주세요.',
    });
  });

  it('토큰 자체 만료가 데이터 접근 만료보다 먼저면 그 날짜로 안내한다', async () => {
    const graph = buildGraph({
      expiresAt: Math.floor(now.getTime() / 1000) + 5 * 86400,
    });
    const task = new InstagramTokenCheckAutopilotTask(graph);
    await expect(task.run()).resolves.toMatchObject({
      skip: false,
      summaryText:
        '⏳ 인스타 토큰 재동의 D-5 (2026-11-10). README 「인스타 토큰 재동의」 절을 따라 갱신해 주세요.',
    });
  });

  it('무효 토큰이면 게시 중단을 안내한다', async () => {
    const task = new InstagramTokenCheckAutopilotTask(
      buildGraph({
        isValid: false,
        expiresAt: 0,
        dataAccessExpiresAt: 0,
        scopes: [],
      }),
    );
    await expect(task.run()).resolves.toMatchObject({
      skip: false,
      summaryText:
        '⚠️ 인스타 토큰이 무효입니다. 릴스 게시가 멈춥니다. README 「인스타 토큰 재동의」 절을 따라 다시 발급해 주세요.',
    });
  });

  it('토큰 조회가 TOKEN_INVALID이면 게시 중단을 안내한다', async () => {
    const graph = buildGraph();
    graph.debugPageToken = jest.fn().mockRejectedValue(
      new InstagramException({
        code: InstagramErrorCode.TOKEN_INVALID,
        message: 'invalid',
      }),
    );
    const task = new InstagramTokenCheckAutopilotTask(graph);
    await expect(task.run()).resolves.toMatchObject({
      skip: false,
      summaryText: expect.stringContaining('인스타 토큰이 무효입니다'),
    });
  });

  it('게시 권한이 빠졌으면 경고한다', async () => {
    const task = new InstagramTokenCheckAutopilotTask(
      buildGraph({ scopes: [] }),
    );
    await expect(task.run()).resolves.toMatchObject({
      skip: false,
      summaryText:
        '⚠️ 인스타 게시 권한(instagram_content_publish)이 빠졌습니다.',
    });
  });

  it('Meta 요청 실패는 orchestrator로 전파한다', async () => {
    const graph = buildGraph();
    const failure = new InstagramException({
      code: InstagramErrorCode.GRAPH_REQUEST_FAILED,
      message: 'Meta 요청 실패',
    });
    graph.debugPageToken = jest.fn().mockRejectedValue(failure);
    const task = new InstagramTokenCheckAutopilotTask(graph);
    await expect(task.run()).rejects.toBe(failure);
  });

  it('앱 토큰 오류는 페이지 토큰 재동의를 안내하지 않는다', async () => {
    const graph = buildGraph();
    const failure = new InstagramException({
      code: InstagramErrorCode.GRAPH_REQUEST_FAILED,
      message: 'META_APP_ID/META_APP_SECRET 확인',
    });
    graph.debugPageToken = jest.fn().mockRejectedValue(failure);
    const task = new InstagramTokenCheckAutopilotTask(graph);
    await expect(task.run()).rejects.toBe(failure);
  });

  it('게시 설정이 없으면 조회 없이 skip 한다', async () => {
    const graph = buildGraph();
    graph.isConfigured = jest.fn().mockReturnValue(false);
    const task = new InstagramTokenCheckAutopilotTask(graph);
    await expect(task.run()).resolves.toEqual({ skip: true });
    expect(graph.debugPageToken).not.toHaveBeenCalled();
  });
});
