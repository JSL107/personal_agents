import { Job } from 'bullmq';

import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { PullRequestReview } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { SlackService } from '../../slack/slack.service';
import { CodeReviewerJobData } from '../domain/webhook.type';
import { WebhookCodeReviewerConsumer } from './code-reviewer.consumer';

const review: PullRequestReview = {
  summary: '로그인 수정',
  riskLevel: 'high',
  mustFix: ['토큰 검증이 빠졌습니다. 상세 secret=abc'],
  niceToHave: [],
  missingTests: [],
  reviewCommentDrafts: [
    { file: 'src/auth.ts', line: 12, body: 'https://user:pass@example.com' },
  ],
  approvalRecommendation: 'request_changes',
  findings: [],
};

describe('WebhookCodeReviewerConsumer', () => {
  const execute = jest.fn().mockResolvedValue({
    result: review,
    agentRunId: 1,
    prTitle: '로그인 버튼 고치기',
  });
  const postMessage = jest.fn().mockResolvedValue({ ts: '123.456' });
  const consumer = new WebhookCodeReviewerConsumer(
    { execute } as unknown as ReviewPullRequestUsecase,
    { postMessage } as unknown as SlackService,
  );
  const job = {
    data: { prRef: 'owner/repo#3', slackUserId: 'U1' },
  } as Job<CodeReviewerJobData>;

  beforeEach(() => {
    jest.clearAllMocks();
    postMessage.mockResolvedValue({ ts: '123.456' });
  });

  it('쉬운 본문을 먼저 보내고 지적 원문은 같은 스레드의 AI 블록으로 보낸다', async () => {
    await consumer.process(job);

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        target: 'U1',
        text: expect.stringContaining('고칠 것 2개'),
      }),
    );
    expect(postMessage.mock.calls[0][0].text).toContain(
      '*로그인 버튼 고치기 리뷰*',
    );
    expect(postMessage.mock.calls[0][0].text).not.toContain('secret=abc');
    expect(postMessage.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        threadTs: '123.456',
        text: expect.stringContaining('AI에 맡길 때'),
      }),
    );
    expect(postMessage.mock.calls[1][0].text).toContain('로그인 버튼 고치기');
    expect(postMessage.mock.calls[1][0].text).toContain('src/auth.ts:12');
    expect(postMessage.mock.calls[1][0].text).not.toContain('user:pass@');
  });

  it('AI 스레드 전송 실패는 본문 발송 성공을 뒤집지 않는다', async () => {
    postMessage
      .mockResolvedValueOnce({ ts: '123.456' })
      .mockRejectedValueOnce(new Error('thread failed'));

    await expect(consumer.process(job)).resolves.toBeUndefined();
    expect(postMessage).toHaveBeenCalledTimes(2);
  });
});
