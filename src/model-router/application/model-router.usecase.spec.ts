import { AgentType, ModelProviderName } from '../domain/model-router.type';
import { ModelProviderPort } from '../domain/port/model-provider.port';
import { CodexQuotaExceededException } from '../infrastructure/codex-cli.provider';
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
  let usecase: ModelRouterUsecase;

  beforeEach(() => {
    chatgptProvider = createProviderMock(ModelProviderName.CHATGPT);
    claudeProvider = createProviderMock(ModelProviderName.CLAUDE);

    usecase = new ModelRouterUsecase(chatgptProvider, claudeProvider);
  });

  // 2026-07-02 정책: 이대리 전체가 ChatGPT(codex) 단일 provider.
  // Claude 는 primary·fallback 어디서도 호출되지 않는다(ClaudeCliProvider 코드는 보존).
  describe('에이전트 → 모델 라우팅 (전부 ChatGPT)', () => {
    it.each([
      [AgentType.PM],
      [AgentType.BE],
      [AgentType.CODE_REVIEWER],
      [AgentType.CTO],
      [AgentType.PO_EVAL],
      [AgentType.CEO],
      [AgentType.CAREER_MATE],
      [AgentType.ISSUE_LABELER],
      [AgentType.WORK_REVIEWER],
    ])('%s → CHATGPT (Claude 호출 0)', async (agentType) => {
      chatgptProvider.complete.mockResolvedValue({
        text: 'ok',
        modelUsed: 'codex-cli',
        provider: ModelProviderName.CHATGPT,
      });

      const result = await usecase.route({
        agentType,
        request: { prompt: 'hi' },
      });

      expect(chatgptProvider.complete).toHaveBeenCalledWith({ prompt: 'hi' });
      expect(result.provider).toBe(ModelProviderName.CHATGPT);
      // Claude 는 primary·fallback 어디서도 불리지 않는다.
      expect(claudeProvider.complete).not.toHaveBeenCalled();
    });
  });

  describe('fallback 없음 — primary(CHATGPT) 실패 시 즉시 실패', () => {
    it('CHATGPT 실패 시 Claude 로 넘어가지 않고 COMPLETION_FAILED', async () => {
      chatgptProvider.complete.mockRejectedValue(new Error('codex down'));

      await expect(
        usecase.route({
          agentType: AgentType.CODE_REVIEWER,
          request: { prompt: 'x' },
        }),
      ).rejects.toMatchObject({ errorCode: 'MODEL_COMPLETION_FAILED' });

      expect(chatgptProvider.complete).toHaveBeenCalledTimes(1);
      expect(claudeProvider.complete).not.toHaveBeenCalled();
    });

    it('실패 시 cause 는 primary 에러만 (fallback 없음)', async () => {
      const chatgptError = new Error('codex down');
      chatgptProvider.complete.mockRejectedValue(chatgptError);

      try {
        await usecase.route({
          agentType: AgentType.PM,
          request: { prompt: 'x' },
        });
        fail('should have thrown');
      } catch (error) {
        expect(error).toMatchObject({ errorCode: 'MODEL_COMPLETION_FAILED' });
        expect((error as { cause: unknown }).cause).toBe(chatgptError);
      }
    });

    it('CodexQuotaExceededException 시 reset 시각을 친절히 안내', async () => {
      chatgptProvider.complete.mockRejectedValue(
        new CodexQuotaExceededException('Jun 11th, 2026 9:28 AM'),
      );

      await expect(
        usecase.route({ agentType: AgentType.PM, request: { prompt: 'x' } }),
      ).rejects.toMatchObject({
        errorCode: 'MODEL_COMPLETION_FAILED',
        message: expect.stringContaining('Jun 11th, 2026 9:28 AM'),
      });

      expect(claudeProvider.complete).not.toHaveBeenCalled();
    });
  });

  describe('EVENING_RETRO 라우팅', () => {
    it('EVENING_RETRO 는 ChatGPT(codex) 로 라우팅된다', () => {
      // AGENT_TO_PROVIDER 는 모듈 내부 const 이므로 route() 가 chatgptProvider 를 호출하는지로 검증.
      chatgptProvider.complete.mockResolvedValue({
        text: 'ok',
        modelUsed: 'codex-cli',
        provider: ModelProviderName.CHATGPT,
      });

      return usecase
        .route({
          agentType: AgentType.EVENING_RETRO,
          request: { prompt: 'retro' },
        })
        .then((result) => {
          expect(result.provider).toBe(ModelProviderName.CHATGPT);
          expect(claudeProvider.complete).not.toHaveBeenCalled();
        });
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
    });
  });
});
