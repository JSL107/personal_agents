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
  const analyzeJdGap = {
    execute: jest.fn().mockResolvedValue({
      result: {
        fitSummary: 'f',
        have: [],
        gaps: ['K8s'],
        topics: [{ title: 'K8s 회고', rationale: 'r' }],
      },
      modelUsed: 'claude-cli',
      agentRunId: 7,
    }),
  };
  const dispatcher = new CareerMateDispatcher(
    modelRouter as never,
    buildProfile as never,
    renderResume as never,
    renderPortfolio as never,
    analyzeJdGap as never,
  );
  return {
    dispatcher,
    buildProfile,
    renderResume,
    renderPortfolio,
    analyzeJdGap,
  };
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

  it('ANALYZE_JD_GAP 의도면 analyzeJdGap 을 호출하고 갭 리포트를 반환한다', async () => {
    const d = makeDispatcher('{"action":"ANALYZE_JD_GAP"}');
    const outcome = await d.dispatcher.dispatch({
      slackUserId: 'U1',
      text: '이 공고 갭 분석 K8s 필수',
    } as never);
    expect(d.analyzeJdGap.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      jdText: '이 공고 갭 분석 K8s 필수',
    });
    expect(outcome.formattedText).toContain('K8s 회고');
    expect(outcome.agentRunId).toBe(7);
  });
});
