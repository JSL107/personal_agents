import { Job } from 'bullmq';

import { InferIssueLabelsUsecase } from '../../agent/issue-labeler/application/infer-issue-labels.usecase';
import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { IssueLabelJobData } from '../domain/webhook.type';
import { WebhookIssueLabelConsumer } from './issue-label.consumer';

describe('WebhookIssueLabelConsumer', () => {
  let githubClient: jest.Mocked<GithubClientPort>;
  let inferUsecase: { execute: jest.Mock };
  let consumer: WebhookIssueLabelConsumer;

  const job = (data: IssueLabelJobData): Job<IssueLabelJobData> =>
    ({ data }) as Job<IssueLabelJobData>;

  beforeEach(() => {
    githubClient = {
      listMyAssignedTasks: jest.fn(),
      getPullRequest: jest.fn(),
      getPullRequestDiff: jest.fn(),
      addIssueComment: jest.fn(),
      listAuthorMergedPullRequestsSince: jest.fn(),
      listAuthorOpenPullRequests: jest.fn(),
      listRepoLabels: jest.fn(),
      addLabelsToIssue: jest.fn(),
      pushBranchAndOpenPr: jest.fn(),
    };
    inferUsecase = { execute: jest.fn() };
    consumer = new WebhookIssueLabelConsumer(
      githubClient,
      inferUsecase as unknown as InferIssueLabelsUsecase,
    );
  });

  const data: IssueLabelJobData = {
    repo: 'foo/bar',
    issueNumber: 42,
    title: 'crash on login',
    body: 'reproduces on staging',
  };

  it('vocab 정상 + LLM labels 반환 → addLabelsToIssue 호출', async () => {
    githubClient.listRepoLabels.mockResolvedValue([
      { name: 'bug', description: '버그' },
      { name: 'docs', description: null },
    ]);
    inferUsecase.execute.mockResolvedValue({
      result: { labels: ['bug'], reasoning: 'stack trace' },
      modelUsed: 'claude-cli',
      agentRunId: 100,
    });

    await consumer.process(job(data));

    expect(githubClient.listRepoLabels).toHaveBeenCalledWith('foo/bar');
    expect(inferUsecase.execute).toHaveBeenCalledWith({
      repo: 'foo/bar',
      issueNumber: 42,
      title: 'crash on login',
      body: 'reproduces on staging',
      availableLabels: [
        { name: 'bug', description: '버그' },
        { name: 'docs', description: null },
      ],
    });
    expect(githubClient.addLabelsToIssue).toHaveBeenCalledWith({
      repo: 'foo/bar',
      issueNumber: 42,
      labels: ['bug'],
    });
  });

  it('repo 에 label vocab 0건 → usecase / addLabels 둘 다 skip', async () => {
    githubClient.listRepoLabels.mockResolvedValue([]);
    await consumer.process(job(data));
    expect(inferUsecase.execute).not.toHaveBeenCalled();
    expect(githubClient.addLabelsToIssue).not.toHaveBeenCalled();
  });

  it('LLM 이 빈 labels 반환 (적합 없음) → addLabels skip', async () => {
    githubClient.listRepoLabels.mockResolvedValue([
      { name: 'bug', description: null },
    ]);
    inferUsecase.execute.mockResolvedValue({
      result: { labels: [], reasoning: '적합 없음' },
      modelUsed: 'claude-cli',
      agentRunId: 101,
    });
    await consumer.process(job(data));
    expect(githubClient.addLabelsToIssue).not.toHaveBeenCalled();
  });

  it('listRepoLabels 실패 → propagate (BullMQ 재시도)', async () => {
    githubClient.listRepoLabels.mockRejectedValue(new Error('rate limited'));
    await expect(consumer.process(job(data))).rejects.toThrow('rate limited');
    expect(inferUsecase.execute).not.toHaveBeenCalled();
    expect(githubClient.addLabelsToIssue).not.toHaveBeenCalled();
  });
});
