import { CareerMateDispatcher } from './career-mate.dispatcher';

const PROFILE = {
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

const makeDispatcher = (intentText: string) => {
  const modelRouter = {
    route: jest.fn().mockResolvedValue({
      text: intentText,
      modelUsed: 'claude-cli',
      provider: 'CLAUDE',
    }),
  };
  const buildProfile = {
    execute: jest.fn().mockResolvedValue({
      result: PROFILE,
      modelUsed: 'claude-cli',
      agentRunId: 1,
    }),
  };
  const renderResume = {
    execute: jest.fn().mockResolvedValue({ profile: PROFILE, agentRunId: 2 }),
  };
  const renderPortfolio = {
    execute: jest.fn().mockResolvedValue({
      url: 'https://notion/x',
      pageId: 'x',
      agentRunId: 3,
    }),
  };
  const dispatcher = new CareerMateDispatcher(
    modelRouter as never,
    buildProfile as never,
    renderResume as never,
    renderPortfolio as never,
  );
  return { dispatcher, buildProfile, renderResume, renderPortfolio };
};

describe('CareerMateDispatcher', () => {
  it('BUILD_PROFILE 의도면 buildProfile 을 호출한다', async () => {
    const d = makeDispatcher('{"action":"BUILD_PROFILE"}');
    const outcome = await d.dispatcher.dispatch({
      slackUserId: 'U1',
      text: '프로필 정리',
    } as never);
    expect(d.buildProfile.execute).toHaveBeenCalledTimes(1);
    expect(outcome.agentRunId).toBe(1);
  });

  it('RENDER_RESUME 의도면 renderResume 을 호출한다', async () => {
    const d = makeDispatcher('{"action":"RENDER_RESUME"}');
    await d.dispatcher.dispatch({ slackUserId: 'U1', text: '이력서' } as never);
    expect(d.renderResume.execute).toHaveBeenCalledTimes(1);
  });

  it('RENDER_PORTFOLIO 의도면 renderPortfolio 를 호출한다', async () => {
    const d = makeDispatcher('{"action":"RENDER_PORTFOLIO"}');
    const outcome = await d.dispatcher.dispatch({
      slackUserId: 'U1',
      text: '포트폴리오',
    } as never);
    expect(d.renderPortfolio.execute).toHaveBeenCalledTimes(1);
    expect(outcome.formattedText).toContain('https://notion/x');
  });

  it('UNKNOWN 이면 안내 문구를 반환한다', async () => {
    const d = makeDispatcher('{"action":"UNKNOWN"}');
    const outcome = await d.dispatcher.dispatch({
      slackUserId: 'U1',
      text: '?',
    } as never);
    expect(d.buildProfile.execute).not.toHaveBeenCalled();
    expect(outcome.formattedText).toContain('프로필');
  });
});
