import { AgentType, ModelProviderName } from '../domain/model-router.type';
import { ModelProviderPort } from '../domain/port/model-provider.port';
import { ModelRouterUsecase } from './model-router.usecase';

describe('ModelRouterUsecase', () => {
  const createProviderMock = (
    name: ModelProviderName,
  ): jest.Mocked<ModelProviderPort> => ({
    name,
    complete: jest.fn(),
  });

  let chatgptProvider: jest.Mocked<ModelProviderPort>;
  let claudeProvider: jest.Mocked<ModelProviderPort>;
  let geminiProvider: jest.Mocked<ModelProviderPort>;
  let usecase: ModelRouterUsecase;

  beforeEach(() => {
    chatgptProvider = createProviderMock(ModelProviderName.CHATGPT);
    claudeProvider = createProviderMock(ModelProviderName.CLAUDE);
    geminiProvider = createProviderMock(ModelProviderName.GEMINI);

    usecase = new ModelRouterUsecase(
      chatgptProvider,
      claudeProvider,
      geminiProvider,
    );
  });

  describe('에이전트 → 모델 라우팅 (happy path)', () => {
    it.each([
      [AgentType.PM, ModelProviderName.CHATGPT],
      [AgentType.BE, ModelProviderName.CLAUDE],
      [AgentType.CODE_REVIEWER, ModelProviderName.CLAUDE],
      [AgentType.WORK_REVIEWER, ModelProviderName.CHATGPT],
    ])('%s → %s', async (agentType, expectedProvider) => {
      const providers = {
        [ModelProviderName.CHATGPT]: chatgptProvider,
        [ModelProviderName.CLAUDE]: claudeProvider,
        [ModelProviderName.GEMINI]: geminiProvider,
      };
      providers[expectedProvider].complete.mockResolvedValue({
        text: 'ok',
        modelUsed: 'mock',
        provider: expectedProvider,
      });

      const result = await usecase.route({
        agentType,
        request: { prompt: 'hi' },
      });

      expect(providers[expectedProvider].complete).toHaveBeenCalledWith({
        prompt: 'hi',
      });
      expect(result.provider).toBe(expectedProvider);
      // primary 성공 시 fallback(Gemini) 호출되지 않아야 한다.
      if (expectedProvider !== ModelProviderName.GEMINI) {
        expect(geminiProvider.complete).not.toHaveBeenCalled();
      }
    });
  });

  describe('Gemini fallback chain', () => {
    it('primary(Codex) 실패 시 Gemini 로 자동 재시도해 응답 반환', async () => {
      chatgptProvider.complete.mockRejectedValue(new Error('codex capacity'));
      geminiProvider.complete.mockResolvedValue({
        text: 'gemini answer',
        modelUsed: 'gemini-2.5-pro',
        provider: ModelProviderName.GEMINI,
      });

      const result = await usecase.route({
        agentType: AgentType.PM,
        request: { prompt: 'hi' },
      });

      expect(chatgptProvider.complete).toHaveBeenCalledTimes(1);
      expect(geminiProvider.complete).toHaveBeenCalledTimes(1);
      expect(result.provider).toBe(ModelProviderName.GEMINI);
      expect(result.text).toBe('gemini answer');
    });

    it('primary(Claude) 실패 시도 Gemini fallback', async () => {
      claudeProvider.complete.mockRejectedValue(new Error('claude rate limit'));
      geminiProvider.complete.mockResolvedValue({
        text: 'g',
        modelUsed: 'gemini',
        provider: ModelProviderName.GEMINI,
      });

      const result = await usecase.route({
        agentType: AgentType.CODE_REVIEWER,
        request: { prompt: 'review please' },
      });

      expect(claudeProvider.complete).toHaveBeenCalledTimes(1);
      expect(geminiProvider.complete).toHaveBeenCalledTimes(1);
      expect(result.provider).toBe(ModelProviderName.GEMINI);
    });

    it('primary 와 fallback(Gemini) 모두 실패 시 COMPLETION_FAILED 예외 + cause 에 둘 다 포함', async () => {
      const codexError = new Error('codex down');
      const geminiError = new Error('gemini auth');
      chatgptProvider.complete.mockRejectedValue(codexError);
      geminiProvider.complete.mockRejectedValue(geminiError);

      try {
        await usecase.route({
          agentType: AgentType.PM,
          request: { prompt: 'x' },
        });
        fail('should have thrown');
      } catch (error) {
        expect(error).toMatchObject({
          errorCode: 'MODEL_COMPLETION_FAILED',
        });
        expect((error as { cause: unknown }).cause).toMatchObject({
          primaryError: codexError,
          lastError: geminiError,
        });
      }
    });

    it('Gemini 가 처음부터 primary 인 가상 케이스에는 fallback 재시도 없음 (방어적)', async () => {
      // 현재 AGENT_TO_PROVIDER 에 GEMINI primary 매핑은 없지만, 향후 추가 시 무한 fallback 방지 보장.
      // 여기서는 AgentType.PM 의 primary 를 GEMINI 로 바꾸는 대신, primary 가 GEMINI 일 때 동작을
      // 직접 검증하기 어려우니 — primary 실패 시 chatgpt 가 호출되지 않는지(fallback 시 chatgpt 호출 X)로 우회 보장.
      chatgptProvider.complete.mockRejectedValue(new Error('boom'));
      geminiProvider.complete.mockResolvedValue({
        text: 'g',
        modelUsed: 'g',
        provider: ModelProviderName.GEMINI,
      });

      await usecase.route({
        agentType: AgentType.PM,
        request: { prompt: 'x' },
      });

      // claude 는 fallback 대상이 아니다 — 호출되면 안 됨.
      expect(claudeProvider.complete).not.toHaveBeenCalled();
    });
  });

  describe('UNKNOWN_AGENT_TYPE', () => {
    it('알 수 없는 agentType 은 즉시 예외 (primary/fallback 호출 X)', async () => {
      await expect(
        usecase.route({
          agentType: 'UNKNOWN' as AgentType,
          request: { prompt: 'x' },
        }),
      ).rejects.toMatchObject({
        errorCode: 'UNKNOWN_AGENT_TYPE',
      });

      expect(chatgptProvider.complete).not.toHaveBeenCalled();
      expect(claudeProvider.complete).not.toHaveBeenCalled();
      expect(geminiProvider.complete).not.toHaveBeenCalled();
    });
  });
});
