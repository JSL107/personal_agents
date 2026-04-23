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

  describe('에이전트 → 모델 라우팅', () => {
    it.each([
      [AgentType.PM, ModelProviderName.CHATGPT],
      [AgentType.BE, ModelProviderName.CLAUDE],
      [AgentType.CODE_REVIEWER, ModelProviderName.CLAUDE],
      [AgentType.WORK_REVIEWER, ModelProviderName.CHATGPT],
    ])('%s → %s', async (agentType, expectedProvider) => {
      // Given
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

      // When
      const result = await usecase.route({
        agentType,
        request: { prompt: 'hi' },
      });

      // Then
      expect(providers[expectedProvider].complete).toHaveBeenCalledWith({
        prompt: 'hi',
      });
      expect(result.provider).toBe(expectedProvider);
    });
  });

  describe('Provider 호출 실패', () => {
    it('예외를 ModelRouterException 으로 감싸 전파한다', async () => {
      // Given
      chatgptProvider.complete.mockRejectedValue(new Error('boom'));

      // When / Then
      await expect(
        usecase.route({
          agentType: AgentType.PM,
          request: { prompt: 'hi' },
        }),
      ).rejects.toMatchObject({
        errorCode: 'MODEL_COMPLETION_FAILED',
      });
    });
  });
});
