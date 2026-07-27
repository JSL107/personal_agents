import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import { ReviewPullRequestUsecase } from '../application/review-pull-request.usecase';
import { CodeReviewerException } from '../domain/code-reviewer.exception';
import { PullRequestReview } from '../domain/code-reviewer.type';
import { CodeReviewerErrorCode } from '../domain/code-reviewer-error-code.enum';
import { CodeReviewerDispatcher } from './code-reviewer.dispatcher';

const review: PullRequestReview = {
  summary: '변경 사항을 검토했습니다.',
  riskLevel: 'low',
  mustFix: [],
  niceToHave: [],
  missingTests: [],
  reviewCommentDrafts: [],
  approvalRecommendation: 'approve',
};

const baseInput: DispatchInput = {
  source: 'SLACK_MESSAGE',
  slackUserId: 'U1',
};

interface DispatcherFixture {
  dispatcher: CodeReviewerDispatcher;
  reviewPullRequestExecute: jest.Mock;
  configGet: jest.Mock;
  listAuthorOpenPullRequests: jest.Mock;
}

function makeFixture(): DispatcherFixture {
  const reviewPullRequestExecute = jest.fn().mockResolvedValue({
    result: review,
    modelUsed: 'codex',
    agentRunId: 7,
  });
  const configGet = jest.fn();
  const listAuthorOpenPullRequests = jest.fn();
  const dispatcher = new CodeReviewerDispatcher(
    {
      execute: reviewPullRequestExecute,
    } as unknown as ReviewPullRequestUsecase,
    { get: configGet } as unknown as ConfigService,
    {
      listAuthorOpenPullRequests,
    } as unknown as GithubClientPort,
  );

  return {
    dispatcher,
    reviewPullRequestExecute,
    configGet,
    listAuthorOpenPullRequests,
  };
}

describe('CodeReviewerDispatcher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('REMOTE_CONSOLE 이외 자연어는 자동 보정 없이 원문을 usecase에 전달한다', async () => {
    const { dispatcher, reviewPullRequestExecute, listAuthorOpenPullRequests } =
      makeFixture();

    const outcome = await dispatcher.dispatch({
      ...baseInput,
      text: '최근 PR을 리뷰해줘',
    });

    expect(reviewPullRequestExecute).toHaveBeenCalledWith({
      prRef: '최근 PR을 리뷰해줘',
      slackUserId: 'U1',
    });
    expect(listAuthorOpenPullRequests).not.toHaveBeenCalled();
    expect(outcome).not.toHaveProperty('autoResolvedNotice');
  });

  it('REMOTE_CONSOLE 유효 PR 참조는 자동 보정하지 않는다', async () => {
    const { dispatcher, reviewPullRequestExecute, listAuthorOpenPullRequests } =
      makeFixture();

    const outcome = await dispatcher.dispatch({
      source: 'REMOTE_CONSOLE',
      slackUserId: 'U1',
      text: 'owner/repo#42',
    });

    expect(reviewPullRequestExecute).toHaveBeenCalledWith({
      prRef: 'owner/repo#42',
      slackUserId: 'U1',
    });
    expect(listAuthorOpenPullRequests).not.toHaveBeenCalled();
    expect(outcome).not.toHaveProperty('autoResolvedNotice');
  });

  it('REMOTE_CONSOLE 자연어와 저자 설정 누락 시 원문을 전달하고 usecase의 INVALID_PR_REFERENCE 예외를 전파한다', async () => {
    const {
      dispatcher,
      reviewPullRequestExecute,
      configGet,
      listAuthorOpenPullRequests,
    } = makeFixture();
    const invalidReferenceException = new CodeReviewerException({
      code: CodeReviewerErrorCode.INVALID_PR_REFERENCE,
      message: 'PR 참조 형식이 잘못되었습니다.',
      status: DomainStatus.BAD_REQUEST,
    });
    reviewPullRequestExecute.mockRejectedValueOnce(invalidReferenceException);

    await expect(
      dispatcher.dispatch({
        source: 'REMOTE_CONSOLE',
        slackUserId: 'U1',
        text: '최근 PR을 리뷰해줘',
      }),
    ).rejects.toBe(invalidReferenceException);
    expect(configGet).toHaveBeenCalledWith('IMPACT_REPORT_GITHUB_AUTHOR');
    expect(listAuthorOpenPullRequests).not.toHaveBeenCalled();
    expect(reviewPullRequestExecute).toHaveBeenCalledWith({
      prRef: '최근 PR을 리뷰해줘',
      slackUserId: 'U1',
    });
  });

  it('REMOTE_CONSOLE 자연어와 open PR이 있으면 최근 PR로 보정하고 notice를 반환한다', async () => {
    const {
      dispatcher,
      reviewPullRequestExecute,
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
      text: '최근 PR을 리뷰해줘',
    });

    expect(listAuthorOpenPullRequests).toHaveBeenCalledWith({
      author: 'JSL107',
      repo: 'JSL107/personal_agents',
      sinceIsoDate: '2026-01-28',
      limit: 1,
    });
    expect(reviewPullRequestExecute).toHaveBeenCalledWith({
      prRef: 'JSL107/personal_agents#42',
      slackUserId: 'U1',
    });
    expect(outcome.autoResolvedNotice).toBe(
      'PR 미지정 → 최근 open PR JSL107/personal_agents#42 자동 선택: 콘솔 리모컨',
    );
  });

  it('REMOTE_CONSOLE 자연어에 open PR이 없으면 review를 실행하지 않고 NO_OPEN_PR_FOUND를 던진다', async () => {
    const {
      dispatcher,
      reviewPullRequestExecute,
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
        text: '최근 PR을 리뷰해줘',
      }),
    ).rejects.toMatchObject({
      codeReviewerErrorCode: CodeReviewerErrorCode.NO_OPEN_PR_FOUND,
      status: DomainStatus.NOT_FOUND,
    } as CodeReviewerException);
    expect(reviewPullRequestExecute).not.toHaveBeenCalled();
  });
});
