import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { AgentType, ModelProviderName } from '../domain/model-router.type';
import { ModelProviderPort } from '../domain/port/model-provider.port';
import { ClaudeAuthSuspectException } from '../infrastructure/claude-cli.provider';
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

  describe('에이전트 → 모델 라우팅 (happy path)', () => {
    it.each([
      [AgentType.PM, ModelProviderName.CHATGPT],
      [AgentType.BE, ModelProviderName.CLAUDE],
      [AgentType.CODE_REVIEWER, ModelProviderName.CLAUDE],
      [AgentType.WORK_REVIEWER, ModelProviderName.CHATGPT],
      // docs-sync-audit Layer 2 — optimizer/evaluator 둘 다 ChatGPT 로 라우팅.
      [AgentType.DOCS_AUDIT_OPTIMIZER, ModelProviderName.CHATGPT],
      [AgentType.DOCS_AUDIT_EVALUATOR, ModelProviderName.CHATGPT],
    ])('%s → %s', async (agentType, expectedProvider) => {
      const providers = {
        [ModelProviderName.CHATGPT]: chatgptProvider,
        [ModelProviderName.CLAUDE]: claudeProvider,
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
      // primary 성공 시 반대편 provider 는 호출되지 않아야 한다.
      const otherProvider =
        expectedProvider === ModelProviderName.CHATGPT
          ? claudeProvider
          : chatgptProvider;
      expect(otherProvider.complete).not.toHaveBeenCalled();
    });
  });

  describe('양방향 fallback chain (CHATGPT ↔ CLAUDE)', () => {
    it('primary(CLAUDE) 실패 시 CHATGPT 로 자동 재시도해 응답 반환', async () => {
      claudeProvider.complete.mockRejectedValue(new Error('claude rate limit'));
      chatgptProvider.complete.mockResolvedValue({
        text: 'chatgpt answer',
        modelUsed: 'codex-cli',
        provider: ModelProviderName.CHATGPT,
      });

      const result = await usecase.route({
        agentType: AgentType.CODE_REVIEWER,
        request: { prompt: 'review please' },
      });

      expect(claudeProvider.complete).toHaveBeenCalledTimes(1);
      expect(chatgptProvider.complete).toHaveBeenCalledTimes(1);
      expect(result.provider).toBe(ModelProviderName.CHATGPT);
      expect(result.text).toBe('chatgpt answer');
    });

    it('primary(CHATGPT) 실패 시 CLAUDE 로 자동 재시도해 응답 반환 (codex 쿼터 소진 등)', async () => {
      // CHATGPT primary 인 agent (예: PM) 의 codex 쿼터 소진 시 Claude CLI 로 fallback.
      chatgptProvider.complete.mockRejectedValue(new Error('codex capacity'));
      claudeProvider.complete.mockResolvedValue({
        text: 'claude answer',
        modelUsed: 'claude-cli',
        provider: ModelProviderName.CLAUDE,
      });

      const result = await usecase.route({
        agentType: AgentType.PM,
        request: { prompt: 'plan please' },
      });

      expect(chatgptProvider.complete).toHaveBeenCalledTimes(1);
      expect(claudeProvider.complete).toHaveBeenCalledTimes(1);
      expect(result.provider).toBe(ModelProviderName.CLAUDE);
      expect(result.text).toBe('claude answer');
    });

    it('primary(CLAUDE) + fallback(CHATGPT) 모두 실패 시 COMPLETION_FAILED + cause 에 둘 다 포함', async () => {
      const claudeError = new Error('claude down');
      const chatgptError = new Error('codex down');
      claudeProvider.complete.mockRejectedValue(claudeError);
      chatgptProvider.complete.mockRejectedValue(chatgptError);

      try {
        await usecase.route({
          agentType: AgentType.CODE_REVIEWER,
          request: { prompt: 'x' },
        });
        fail('should have thrown');
      } catch (error) {
        expect(error).toMatchObject({
          errorCode: 'MODEL_COMPLETION_FAILED',
        });
        expect((error as { cause: unknown }).cause).toMatchObject({
          primaryError: claudeError,
          lastError: chatgptError,
        });
      }
    });

    it('primary(CHATGPT) + fallback(CLAUDE) 모두 실패 시 COMPLETION_FAILED + cause 에 둘 다 포함', async () => {
      const chatgptError = new Error('codex down');
      const claudeError = new Error('claude down');
      chatgptProvider.complete.mockRejectedValue(chatgptError);
      claudeProvider.complete.mockRejectedValue(claudeError);

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
          primaryError: chatgptError,
          lastError: claudeError,
        });
      }
    });

    it('CHATGPT 쿼터 소진(CodexQuotaExceededException) + CLAUDE 도 실패 시 에러 메시지에 reset 시각을 친절히 안내', async () => {
      chatgptProvider.complete.mockRejectedValue(
        new CodexQuotaExceededException('Jun 11th, 2026 9:28 AM'),
      );
      claudeProvider.complete.mockRejectedValue(new Error('claude down'));

      await expect(
        usecase.route({
          agentType: AgentType.PM,
          request: { prompt: 'x' },
        }),
      ).rejects.toMatchObject({
        errorCode: 'MODEL_COMPLETION_FAILED',
        message: expect.stringContaining('Jun 11th, 2026 9:28 AM'),
      });
    });
  });

  describe('claude 인증 의심 owner 알람', () => {
    const buildPublisher = (): jest.Mocked<NotificationPublisher> =>
      ({
        publishClaudeAuthSuspect: jest.fn(),
        publishCronFailure: jest.fn(),
      }) as unknown as jest.Mocked<NotificationPublisher>;

    it('primary(Claude) 가 ClaudeAuthSuspectException 일 때 publisher.publishClaudeAuthSuspect 호출', async () => {
      const publisher = buildPublisher();
      const usecaseWithPublisher = new ModelRouterUsecase(
        chatgptProvider,
        claudeProvider,
        publisher,
      );
      claudeProvider.complete.mockRejectedValue(
        new ClaudeAuthSuspectException(
          'claude CLI 인증 만료 / 쿼터 소진 의심 (exit=1). (no stderr)',
        ),
      );
      chatgptProvider.complete.mockResolvedValue({
        text: 'g',
        modelUsed: 'codex',
        provider: ModelProviderName.CHATGPT,
      });

      await usecaseWithPublisher.route({
        agentType: AgentType.CODE_REVIEWER,
        request: { prompt: 'x' },
      });

      expect(publisher.publishClaudeAuthSuspect).toHaveBeenCalledWith({
        exitMessage: expect.stringContaining('인증 만료'),
      });
    });

    it('fallback(Claude) 가 ClaudeAuthSuspectException 이면 owner 알람 발사 (CHATGPT primary → Claude fallback 슬롯)', async () => {
      const publisher = buildPublisher();
      const usecaseWithPublisher = new ModelRouterUsecase(
        chatgptProvider,
        claudeProvider,
        publisher,
      );
      // PM(CHATGPT primary) codex 쿼터 소진 → Claude fallback 인데 Claude 인증까지 의심.
      chatgptProvider.complete.mockRejectedValue(new Error('codex quota'));
      claudeProvider.complete.mockRejectedValue(
        new ClaudeAuthSuspectException('claude CLI 인증 만료 의심 (exit=1)'),
      );

      await expect(
        usecaseWithPublisher.route({
          agentType: AgentType.PM,
          request: { prompt: 'x' },
        }),
      ).rejects.toMatchObject({ errorCode: 'MODEL_COMPLETION_FAILED' });

      expect(publisher.publishClaudeAuthSuspect).toHaveBeenCalledWith({
        exitMessage: expect.stringContaining('인증 만료'),
      });
    });

    it('primary 가 일반 Error 일 때 publisher 미호출 (인증 의심 케이스만)', async () => {
      const publisher = buildPublisher();
      const usecaseWithPublisher = new ModelRouterUsecase(
        chatgptProvider,
        claudeProvider,
        publisher,
      );
      claudeProvider.complete.mockRejectedValue(
        new Error('일반 timeout 같은 비-인증 에러'),
      );
      chatgptProvider.complete.mockResolvedValue({
        text: 'g',
        modelUsed: 'codex',
        provider: ModelProviderName.CHATGPT,
      });

      await usecaseWithPublisher.route({
        agentType: AgentType.CODE_REVIEWER,
        request: { prompt: 'x' },
      });

      expect(publisher.publishClaudeAuthSuspect).not.toHaveBeenCalled();
    });

    it('publisher 미주입 (NotificationQueueModule 미연결) 환경에서도 fallback 흐름 정상 동작', async () => {
      // 기본 usecase 는 publisher 없이 만들어짐 — 인증 의심 에러여도 fallback 진행 + 예외 X.
      claudeProvider.complete.mockRejectedValue(
        new ClaudeAuthSuspectException('test'),
      );
      chatgptProvider.complete.mockResolvedValue({
        text: 'g',
        modelUsed: 'codex',
        provider: ModelProviderName.CHATGPT,
      });

      const result = await usecase.route({
        agentType: AgentType.CODE_REVIEWER,
        request: { prompt: 'x' },
      });

      expect(result.provider).toBe(ModelProviderName.CHATGPT);
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
