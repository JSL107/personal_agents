import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { ImpactReporterException } from '../domain/impact-reporter.exception';
import { ImpactReport } from '../domain/impact-reporter.type';
import { ImpactReporterErrorCode } from '../domain/impact-reporter-error-code.enum';
import { GenerateImpactReportUsecase } from './generate-impact-report.usecase';

describe('GenerateImpactReportUsecase', () => {
  const validReport: ImpactReport = {
    subject: 'PR #34 — GitHub 커넥터 추가',
    headline: '리뷰 자동화로 평균 리드타임 −2h',
    quantitative: ['리드타임 −2h', '리뷰 누락 0건'],
    qualitative: '리뷰어 부담 감소 + 사용자 응답 일관성',
    affectedAreas: {
      users: ['Slack 사용자'],
      team: ['리뷰어'],
      service: ['리뷰 파이프라인'],
    },
    beforeAfter: {
      before: '리뷰 누락이 잦았음',
      after: '자동 리뷰로 누락 0건',
    },
    risks: ['Codex 쿼터 소진 시 fallback 필요'],
    reasoning: 'PR diff/test 결과 + 최근 1주 리뷰 통계로 임팩트를 산정했다.',
  };

  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let githubClient: jest.Mocked<GithubClientPort>;
  let usecase: GenerateImpactReportUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 7 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 7,
      };
    });
    githubClient = {
      listMyAssignedTasks: jest.fn(),
      getPullRequest: jest.fn(),
      getPullRequestDiff: jest.fn(),
      addIssueComment: jest.fn(),
    };

    usecase = new GenerateImpactReportUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      { execute: agentRunServiceExecute } as unknown as AgentRunService,
      githubClient,
    );

    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validReport),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    } satisfies CompletionResponse);
  });

  it('subject 가 비어 있으면 EMPTY_SUBJECT 예외', async () => {
    await expect(
      usecase.execute({ subject: '   ', slackUserId: 'U1' }),
    ).rejects.toMatchObject({
      impactReporterErrorCode: ImpactReporterErrorCode.EMPTY_SUBJECT,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('AgentRunService 에 IMPACT_REPORTER + SLACK_COMMAND_IMPACT_REPORT 전달', async () => {
    await usecase.execute({
      subject: 'PR #34',
      slackUserId: 'U1',
    });
    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.IMPACT_REPORTER);
    expect(call.triggerType).toBe('SLACK_COMMAND_IMPACT_REPORT');
    expect(call.evidence).toEqual([
      {
        sourceType: 'SLACK_COMMAND_IMPACT_REPORT',
        sourceId: 'U1',
        payload: { subject: 'PR #34' },
      },
    ]);
  });

  it('모델 응답을 ImpactReport 로 파싱해 반환', async () => {
    const result = await usecase.execute({
      subject: 'PR #34',
      slackUserId: 'U1',
    });
    expect(result.result).toEqual(validReport);
    expect(result.modelUsed).toBe('codex-cli');
    expect(result.agentRunId).toBe(7);
  });

  it('모델 응답이 schema 와 안 맞으면 INVALID_MODEL_OUTPUT 예외', async () => {
    modelRouter.route.mockResolvedValue({
      text: '{"foo": "bar"}',
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });
    await expect(
      usecase.execute({ subject: 'x', slackUserId: 'U1' }),
    ).rejects.toBeInstanceOf(ImpactReporterException);
  });

  describe('GitHub PR grounding (codex review b6xkjewd2 P2)', () => {
    it('PR URL 입력 시 GitHub 에서 PR detail fetch + prompt 에 inline 포함', async () => {
      githubClient.getPullRequest.mockResolvedValue({
        number: 34,
        title: 'GitHub 커넥터 추가',
        repo: 'foo/bar',
        url: 'https://github.com/foo/bar/pull/34',
        body: 'PR 본문',
        baseRef: 'main',
        headRef: 'feat/github-connector',
        authorLogin: 'JSL107',
        changedFiles: [],
        changedFilesTruncated: false,
        changedFilesTotalCount: 0,
        additions: 0,
        deletions: 0,
      });

      await usecase.execute({
        subject: 'https://github.com/foo/bar/pull/34',
        slackUserId: 'U1',
      });

      expect(githubClient.getPullRequest).toHaveBeenCalledWith({
        repo: 'foo/bar',
        number: 34,
      });
      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).toContain('[GitHub PR foo/bar#34]');
      expect(promptArg).toContain('Title: GitHub 커넥터 추가');
      expect(promptArg).toContain('PR 본문');
    });

    it('shorthand owner/repo#N 도 PR fetch + GITHUB_PR_DETAIL evidence 추가', async () => {
      githubClient.getPullRequest.mockResolvedValue({
        number: 7,
        title: 't',
        repo: 'a/b',
        url: 'https://github.com/a/b/pull/7',
        body: 'b',
        baseRef: 'main',
        headRef: 'f',
        authorLogin: 'a',
        changedFiles: [],
        changedFilesTruncated: false,
        changedFilesTotalCount: 0,
        additions: 0,
        deletions: 0,
      });

      await usecase.execute({ subject: 'a/b#7', slackUserId: 'U1' });

      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceType: 'GITHUB_PR_DETAIL',
            sourceId: 'a/b#7',
          }),
        ]),
      );
      expect(call.inputSnapshot.prGroundingAttempted).toBe(true);
      expect(call.inputSnapshot.prGroundingSucceeded).toBe(true);
    });

    it('자유 텍스트 입력은 GitHub fetch 시도 X — prompt 에 subject 만', async () => {
      await usecase.execute({
        subject: '사내 회고 자동화 도입',
        slackUserId: 'U1',
      });

      expect(githubClient.getPullRequest).not.toHaveBeenCalled();
      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).toBe('사내 회고 자동화 도입');
      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.prGroundingAttempted).toBe(false);
    });

    it('GitHub fetch 실패 시 graceful fallback — 자유 텍스트로 진행', async () => {
      githubClient.getPullRequest.mockRejectedValue(
        new Error('GITHUB_TOKEN not set'),
      );

      const result = await usecase.execute({
        subject: 'a/b#7',
        slackUserId: 'U1',
      });

      expect(result.result).toEqual(validReport);
      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.prGroundingAttempted).toBe(true);
      expect(call.inputSnapshot.prGroundingSucceeded).toBe(false);
      expect(call.evidence).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceType: 'GITHUB_PR_DETAIL' }),
        ]),
      );
    });
  });
});
