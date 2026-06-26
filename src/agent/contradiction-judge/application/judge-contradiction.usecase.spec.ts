import { CodexQuotaExceededException } from '../../../model-router/infrastructure/codex-cli.provider';
import { JudgeContradictionUsecase } from './judge-contradiction.usecase';

function makeRouter(text: string) {
  return {
    route: jest
      .fn()
      .mockResolvedValue({ text, modelUsed: 'gpt', provider: 'CHATGPT' }),
  };
}

describe('JudgeContradictionUsecase', () => {
  it('JSON 파싱 — contradiction/reason 추출', async () => {
    const router = makeRouter('{"contradiction": true, "reason": "결론 충돌"}');
    const usecase = new JudgeContradictionUsecase(router as never);

    const verdict = await usecase.judge({ textA: 'a', textB: 'b' });

    expect(verdict.contradiction).toBe(true);
    expect(verdict.reason).toBe('결론 충돌');
  });

  it('파싱 실패 시 보수적으로 contradiction=false', async () => {
    const router = makeRouter('헛소리 비 JSON 응답');
    const usecase = new JudgeContradictionUsecase(router as never);

    const verdict = await usecase.judge({ textA: 'a', textB: 'b' });

    expect(verdict.contradiction).toBe(false);
  });

  it('쿼터 소진(ModelRouterException cause)이면 CodexQuotaExceededException 을 re-throw', async () => {
    const quota = new CodexQuotaExceededException('Jun 30');
    const wrapped = Object.assign(new Error('모델 호출 실패'), {
      cause: { primaryError: quota, lastError: quota },
    });
    const router = { route: jest.fn().mockRejectedValue(wrapped) };
    const usecase = new JudgeContradictionUsecase(router as never);

    await expect(
      usecase.judge({ textA: 'a', textB: 'b' }),
    ).rejects.toBeInstanceOf(CodexQuotaExceededException);
  });
});
