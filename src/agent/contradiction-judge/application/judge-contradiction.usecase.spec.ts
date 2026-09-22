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

  // 이 케이스는 원래 "보수적으로 contradiction=false" 를 계약했다. 뒤집은 이유는 호출자
  // (KnowledgeLintService.detectContradictions)가 판정을 끝낸 쌍 수(judged)로 부분 실패를
  // 드러내도록 설계돼 있기 때문이다 — false 를 돌려주면 그 쌍이 judged 에 집계돼 "판정했고
  // 모순 없음" 이 되고, 호출자가 세우려던 방어가 그대로 무력화된다. 던지면 호출자의 기존
  // catch 가 쌍을 skip 하고 judged 를 올리지 않아, 점검 장애가 정상으로 위장되지 않는다.
  it('JSON 이 없으면 판정을 지어내지 않고 throw', async () => {
    const router = makeRouter('헛소리 비 JSON 응답');
    const usecase = new JudgeContradictionUsecase(router as never);

    await expect(usecase.judge({ textA: 'a', textB: 'b' })).rejects.toThrow(
      /JSON 을 찾지 못했습니다/,
    );
  });

  // 중괄호는 있어서 추출 정규식은 통과하지만 JSON.parse 가 거부하는 형태.
  it('JSON 형태지만 깨져 있으면 throw', async () => {
    const router = makeRouter('{"contradiction": true, "reason":}');
    const usecase = new JudgeContradictionUsecase(router as never);

    await expect(usecase.judge({ textA: 'a', textB: 'b' })).rejects.toThrow(
      /파싱 실패/,
    );
  });

  // 가장 조용한 실패 — JSON 도 멀쩡하고 키도 있는데 타입만 다르다. 예전 구현은 `=== true`
  // 라 이 응답을 "모순 없음" 으로 통과시켰다.
  it('contradiction 이 boolean 이 아니면 throw', async () => {
    const router = makeRouter('{"contradiction": "true", "reason": "충돌"}');
    const usecase = new JudgeContradictionUsecase(router as never);

    await expect(usecase.judge({ textA: 'a', textB: 'b' })).rejects.toThrow(
      /boolean 이 아닙니다/,
    );
  });

  it('contradiction=false 는 정상 판정으로 통과', async () => {
    const router = makeRouter('{"contradiction": false, "reason": ""}');
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
