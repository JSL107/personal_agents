import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { AgentType } from '../../../model-router/domain/model-router.type';
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
  findings: [],
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
      publish: true,
      // source 가 SLACK_MESSAGE 인 경로 — 콘솔과 다른 트리거로 기록돼야 한다.
      triggerType: 'SLACK_MENTION_CODE_REVIEWER',
    });
    expect(listAuthorOpenPullRequests).not.toHaveBeenCalled();
    expect(outcome).not.toHaveProperty('autoResolvedNotice');
  });

  it('호출부가 publish:false 를 주면 그대로 내려 게시하지 않는다 (잠재의식 카드 경로)', async () => {
    const { dispatcher, reviewPullRequestExecute } = makeFixture();

    await dispatcher.dispatch({
      ...baseInput,
      text: 'owner/repo#1',
      publish: false,
    });

    expect(reviewPullRequestExecute).toHaveBeenCalledWith(
      expect.objectContaining({ publish: false }),
    );
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
      publish: true,
      triggerType: 'REMOTE_CONSOLE_CODE_REVIEWER',
    });
    expect(listAuthorOpenPullRequests).not.toHaveBeenCalled();
    expect(outcome).not.toHaveProperty('autoResolvedNotice');
  });

  it('REMOTE_CONSOLE에 잘못된 PR 참조를 입력하면 최근 PR로 바꾸지 않고 검증 오류를 전파한다', async () => {
    const {
      dispatcher,
      reviewPullRequestExecute,
      configGet,
      listAuthorOpenPullRequests,
    } = makeFixture();
    configGet.mockReturnValue('JSL107');
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
        text: 'https://github.com/JSL107/personal_agents/issues/537',
      }),
    ).rejects.toBe(invalidReferenceException);
    expect(configGet).not.toHaveBeenCalled();
    expect(listAuthorOpenPullRequests).not.toHaveBeenCalled();
  });

  it('REMOTE_CONSOLE 자연어는 설정과 무관하게 원문 검증 오류를 전파한다', async () => {
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
    expect(configGet).not.toHaveBeenCalled();
    expect(listAuthorOpenPullRequests).not.toHaveBeenCalled();
    expect(reviewPullRequestExecute).toHaveBeenCalledWith({
      prRef: '최근 PR을 리뷰해줘',
      slackUserId: 'U1',
      publish: true,
      triggerType: 'REMOTE_CONSOLE_CODE_REVIEWER',
    });
  });

  it('REMOTE_CONSOLE 입력이 비어 있고 open PR이 있으면 최근 PR로 보정하고 notice를 반환한다', async () => {
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
      text: '   ',
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
      publish: true,
      triggerType: 'REMOTE_CONSOLE_CODE_REVIEWER',
    });
    expect(outcome.autoResolvedNotice).toBe(
      'PR 미지정 → 최근 open PR JSL107/personal_agents#42 자동 선택: 콘솔 리모컨',
    );
  });

  it('REMOTE_CONSOLE 입력이 비었는데 open PR도 없으면 review를 실행하지 않고 NO_OPEN_PR_FOUND를 던진다', async () => {
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
        text: '',
      }),
    ).rejects.toMatchObject({
      codeReviewerErrorCode: CodeReviewerErrorCode.NO_OPEN_PR_FOUND,
      status: DomainStatus.NOT_FOUND,
    } as CodeReviewerException);
    expect(reviewPullRequestExecute).not.toHaveBeenCalled();
  });

  describe('링크 없는 후속 지시와 게시 결과 (2026-08-27)', () => {
    const PR_282_LINK =
      '<https://github.com/schoolbell-e/sbe-survey-v5/pull/282|github.com/schoolbell-e/sbe-survey-v5/pull/282>';
    const reviewTurn = (text: string, agentType: AgentType | null) => ({
      role: 'user' as const,
      text,
      agentType,
      agentRunId: null,
      timestampMs: 0,
    });

    it('원문에 PR 이 없으면 직전 코드 리뷰 턴의 PR 로 리뷰한다', async () => {
      const { dispatcher, reviewPullRequestExecute } = makeFixture();

      await dispatcher.dispatch({
        ...baseInput,
        text: '게시까지 진행해줘.',
        priorTurns: [
          reviewTurn(`${PR_282_LINK} 이거 리뷰 가능?`, AgentType.CODE_REVIEWER),
        ],
      });

      expect(reviewPullRequestExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          prRef: 'schoolbell-e/sbe-survey-v5#282',
          publish: true,
        }),
      );
    });

    it('직전 리뷰 턴에 PR 이 여럿이면 리뷰를 실행하지 않고 되묻는다', async () => {
      const { dispatcher, reviewPullRequestExecute } = makeFixture();

      await expect(
        dispatcher.dispatch({
          ...baseInput,
          text: '게시해줘',
          priorTurns: [
            reviewTurn(`${PR_282_LINK} 리뷰`, AgentType.CODE_REVIEWER),
            reviewTurn(
              'JSL107/personal_agents#741 리뷰',
              AgentType.CODE_REVIEWER,
            ),
          ],
        }),
      ).rejects.toMatchObject({
        codeReviewerErrorCode: CodeReviewerErrorCode.AMBIGUOUS_PR_REFERENCE,
      });
      expect(reviewPullRequestExecute).not.toHaveBeenCalled();
    });

    it('Slack 자연어에서 PR 을 끝내 못 찾으면 슬래시 사용법 대신 대화 문구로 알린다', async () => {
      const { dispatcher, reviewPullRequestExecute } = makeFixture();
      reviewPullRequestExecute.mockRejectedValueOnce(
        new CodeReviewerException({
          code: CodeReviewerErrorCode.INVALID_PR_REFERENCE,
          message:
            'PR 참조 형식이 잘못되었습니다: "게시해줘". 사용 예: `/review-pr …`',
          status: DomainStatus.BAD_REQUEST,
        }),
      );

      const rejected = dispatcher.dispatch({ ...baseInput, text: '게시해줘' });

      await expect(rejected).rejects.toMatchObject({
        codeReviewerErrorCode: CodeReviewerErrorCode.INVALID_PR_REFERENCE,
      });
      await expect(rejected).rejects.not.toThrow('/review-pr');
    });

    it('게시 결과를 리뷰 본문 아래 한 줄로 붙인다', async () => {
      const { dispatcher, reviewPullRequestExecute } = makeFixture();
      reviewPullRequestExecute.mockResolvedValueOnce({
        result: review,
        modelUsed: 'codex',
        agentRunId: 7,
        publication: {
          kind: 'NOT_ALLOWED',
          repo: 'schoolbell-e/sbe-survey-v5',
        },
      });

      const outcome = await dispatcher.dispatch({
        ...baseInput,
        text: `${PR_282_LINK} 리뷰해줘`,
      });

      expect(outcome.formattedText).toContain(
        '게시 허용 목록(PR_REVIEW_INLINE_REPOS)에 없어요',
      );
    });
  });
});
