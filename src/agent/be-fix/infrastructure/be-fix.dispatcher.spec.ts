import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import { AnalyzePrConventionUsecase } from '../application/analyze-pr-convention.usecase';
import { BeFixException } from '../domain/be-fix.exception';
import { PrConventionReport } from '../domain/be-fix.type';
import { BeFixErrorCode } from '../domain/be-fix-error-code.enum';
import { BeFixDispatcher } from './be-fix.dispatcher';

const report: PrConventionReport = {
  prRef: 'owner/repo#42',
  prTitle: '콘솔 리모컨',
  baseSha: 'base-sha',
  headSha: 'head-sha',
  diffByteLength: 120,
  diffTruncated: false,
  violations: [],
  summary: '컨벤션 위반이 없습니다.',
};

const baseInput: DispatchInput = {
  source: 'SLACK_MESSAGE',
  slackUserId: 'U1',
};

interface DispatcherFixture {
  dispatcher: BeFixDispatcher;
  analyzePrConventionExecute: jest.Mock;
  configGet: jest.Mock;
  listAuthorOpenPullRequests: jest.Mock;
}

type BeFixDispatcherConstructor = new (
  analyzePrConvention: AnalyzePrConventionUsecase,
  config: ConfigService,
  githubClient: GithubClientPort,
) => BeFixDispatcher;

function makeFixture(): DispatcherFixture {
  const analyzePrConventionExecute = jest.fn().mockResolvedValue({
    result: report,
    modelUsed: 'codex',
    agentRunId: 7,
  });
  const configGet = jest.fn();
  const listAuthorOpenPullRequests = jest.fn();
  const Dispatcher = BeFixDispatcher as unknown as BeFixDispatcherConstructor;
  const dispatcher = new Dispatcher(
    {
      execute: analyzePrConventionExecute,
    } as unknown as AnalyzePrConventionUsecase,
    { get: configGet } as unknown as ConfigService,
    {
      listAuthorOpenPullRequests,
    } as unknown as GithubClientPort,
  );

  return {
    dispatcher,
    analyzePrConventionExecute,
    configGet,
    listAuthorOpenPullRequests,
  };
}

describe('BeFixDispatcher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('REMOTE_CONSOLE 이외 자연어는 자동 보정 없이 원문을 usecase에 전달한다', async () => {
    const {
      dispatcher,
      analyzePrConventionExecute,
      listAuthorOpenPullRequests,
    } = makeFixture();

    const outcome = await dispatcher.dispatch({
      ...baseInput,
      text: '최근 PR을 고쳐줘',
    });

    expect(analyzePrConventionExecute).toHaveBeenCalledWith({
      prRef: '최근 PR을 고쳐줘',
      slackUserId: 'U1',
    });
    expect(listAuthorOpenPullRequests).not.toHaveBeenCalled();
    expect(outcome).not.toHaveProperty('autoResolvedNotice');
  });

  it('REMOTE_CONSOLE 유효 PR 참조는 공백을 포함해 자동 보정하지 않는다', async () => {
    const {
      dispatcher,
      analyzePrConventionExecute,
      listAuthorOpenPullRequests,
    } = makeFixture();

    const outcome = await dispatcher.dispatch({
      source: 'REMOTE_CONSOLE',
      slackUserId: 'U1',
      text: ' owner/repo#42 ',
    });

    expect(analyzePrConventionExecute).toHaveBeenCalledWith({
      prRef: ' owner/repo#42 ',
      slackUserId: 'U1',
    });
    expect(listAuthorOpenPullRequests).not.toHaveBeenCalled();
    expect(outcome).not.toHaveProperty('autoResolvedNotice');
  });

  it('REMOTE_CONSOLE 자연어와 저자 설정 누락 시 원문을 전달하고 usecase의 INVALID_PR_REF 예외를 전파한다', async () => {
    const {
      dispatcher,
      analyzePrConventionExecute,
      configGet,
      listAuthorOpenPullRequests,
    } = makeFixture();
    const invalidReferenceException = new BeFixException({
      code: BeFixErrorCode.INVALID_PR_REF,
      message: 'PR 참조 형식이 잘못되었습니다.',
      status: DomainStatus.BAD_REQUEST,
    });
    analyzePrConventionExecute.mockRejectedValueOnce(invalidReferenceException);

    await expect(
      dispatcher.dispatch({
        source: 'REMOTE_CONSOLE',
        slackUserId: 'U1',
        text: '최근 PR을 고쳐줘',
      }),
    ).rejects.toBe(invalidReferenceException);
    expect(configGet).toHaveBeenCalledWith('IMPACT_REPORT_GITHUB_AUTHOR');
    expect(listAuthorOpenPullRequests).not.toHaveBeenCalled();
    expect(analyzePrConventionExecute).toHaveBeenCalledWith({
      prRef: '최근 PR을 고쳐줘',
      slackUserId: 'U1',
    });
  });

  it('REMOTE_CONSOLE 자연어와 open PR이 있으면 최근 PR로 보정하고 notice를 반환한다', async () => {
    const {
      dispatcher,
      analyzePrConventionExecute,
      configGet,
      listAuthorOpenPullRequests,
    } = makeFixture();
    configGet.mockImplementation((key: string) => {
      if (key === 'IMPACT_REPORT_GITHUB_AUTHOR') {
        return 'JSL107';
      }
      if (key === 'IMPACT_REPORT_GITHUB_REPO') {
        return 'JSL107/personal_agents';
      }
      return undefined;
    });
    listAuthorOpenPullRequests.mockResolvedValue([
      {
        repo: 'JSL107/personal_agents',
        number: 42,
        title: '콘솔 리모컨',
        body: '',
        url: 'https://github.com/JSL107/personal_agents/pull/42',
        state: 'open',
        mergedAt: null,
        updatedAt: '2026-07-27T11:00:00.000Z',
        additions: 1,
        deletions: 0,
        changedFilesCount: 1,
      },
    ]);

    const outcome = await dispatcher.dispatch({
      source: 'REMOTE_CONSOLE',
      slackUserId: 'U1',
      text: '최근 PR을 고쳐줘',
    });

    expect(listAuthorOpenPullRequests).toHaveBeenCalledWith({
      author: 'JSL107',
      repo: 'JSL107/personal_agents',
      sinceIsoDate: '2026-01-28',
      limit: 1,
    });
    expect(analyzePrConventionExecute).toHaveBeenCalledWith({
      prRef: 'JSL107/personal_agents#42',
      slackUserId: 'U1',
    });
    expect(outcome.autoResolvedNotice).toBe(
      'PR 미지정 → 최근 open PR JSL107/personal_agents#42 자동 선택: 콘솔 리모컨',
    );
  });

  it('REMOTE_CONSOLE 자연어에 open PR이 없으면 분석을 실행하지 않고 NO_OPEN_PR_FOUND를 던진다', async () => {
    const {
      dispatcher,
      analyzePrConventionExecute,
      configGet,
      listAuthorOpenPullRequests,
    } = makeFixture();
    configGet.mockImplementation((key: string) =>
      key === 'IMPACT_REPORT_GITHUB_AUTHOR' ? 'JSL107' : undefined,
    );
    listAuthorOpenPullRequests.mockResolvedValue([]);

    await expect(
      dispatcher.dispatch({
        source: 'REMOTE_CONSOLE',
        slackUserId: 'U1',
        text: '최근 PR을 고쳐줘',
      }),
    ).rejects.toMatchObject({
      beFixErrorCode: BeFixErrorCode.NO_OPEN_PR_FOUND,
      status: DomainStatus.NOT_FOUND,
    } as BeFixException);
    expect(analyzePrConventionExecute).not.toHaveBeenCalled();
  });
});
