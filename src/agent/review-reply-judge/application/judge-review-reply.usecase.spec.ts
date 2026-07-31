import { AgentType } from '../../../model-router/domain/model-router.type';
import { CodexQuotaExceededException } from '../../../model-router/infrastructure/codex-cli.provider';
import { JudgeReviewReplyUsecase } from './judge-review-reply.usecase';

const items = [
  { id: 11, body: '트랜잭션 경계가 없다', replyBody: '수정했습니다' },
  { id: 12, body: 'null 검증이 없다', replyBody: '의도된 동작입니다' },
];

const router = (text: string) => ({
  route: jest
    .fn()
    .mockResolvedValue({ text, modelUsed: 'gpt', provider: 'CHATGPT' }),
});

describe('JudgeReviewReplyUsecase', () => {
  it('PR 카드 배치를 모델 1회로 판정하고 JSON 배열을 파싱한다', async () => {
    const modelRouter = router(
      '응답:\n[{"id":11,"verdict":"ACCEPTED","reason":"수정함"},{"id":12,"verdict":"REJECTED","reason":"의도임"}]',
    );
    const usecase = new JudgeReviewReplyUsecase(modelRouter as never);

    const verdicts = await usecase.execute({ items });

    expect(modelRouter.route).toHaveBeenCalledTimes(1);
    expect(modelRouter.route).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: AgentType.REVIEW_REPLY_JUDGE }),
    );
    expect(verdicts).toEqual([
      { id: 11, verdict: 'ACCEPTED', reason: '수정함' },
      { id: 12, verdict: 'REJECTED', reason: '의도임' },
    ]);
  });

  it('JSON 배열 파싱 실패 시 모든 항목을 UNCLEAR로 보수 처리한다', async () => {
    const usecase = new JudgeReviewReplyUsecase(
      router('JSON 아닌 답변') as never,
    );

    await expect(usecase.execute({ items })).resolves.toEqual([
      { id: 11, verdict: 'UNCLEAR', reason: '' },
      { id: 12, verdict: 'UNCLEAR', reason: '' },
    ]);
  });

  it('누락 항목과 알 수 없는 verdict만 UNCLEAR로 처리한다', async () => {
    const usecase = new JudgeReviewReplyUsecase(
      router('[{"id":11,"verdict":"MAYBE","reason":"모름"}]') as never,
    );

    await expect(usecase.execute({ items })).resolves.toEqual([
      { id: 11, verdict: 'UNCLEAR', reason: '' },
      { id: 12, verdict: 'UNCLEAR', reason: '' },
    ]);
  });

  it('감싸진 CodexQuotaExceededException은 원본 예외로 전파한다', async () => {
    const quota = new CodexQuotaExceededException('Aug 1');
    const modelRouter = {
      route: jest.fn().mockRejectedValue(
        Object.assign(new Error('model failed'), {
          cause: { primaryError: quota },
        }),
      ),
    };
    const usecase = new JudgeReviewReplyUsecase(modelRouter as never);

    await expect(usecase.execute({ items })).rejects.toBe(quota);
  });
});
