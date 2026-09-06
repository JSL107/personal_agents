import { Logger } from '@nestjs/common';

import {
  LLM_CLI_MAX_ATTEMPTS,
  LLM_CLI_RETRY_BACKOFF_BASE_MS,
  LLM_CLI_RETRY_BACKOFF_JITTER_MS,
  LLM_CLI_TIMEOUT_MS,
  MODEL_ROUTER_WORST_CASE_MS,
} from '../../common/llm/llm-timeout.constant';
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
      [AgentType.CODE_REVIEWER],
      [AgentType.CODE_REVIEWER],
      [AgentType.CTO_STUDY],
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

      // 계약이 있는 에이전트는 프롬프트 앞에 사규 머리말이 붙는다(buildContractPreamble).
      // 이 테스트의 목적은 라우팅 대상 provider 확인이므로 원본 프롬프트 보존만 본다.
      expect(chatgptProvider.complete).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: expect.stringContaining('hi') }),
      );
      expect(result.provider).toBe(ModelProviderName.CHATGPT);
      // Claude 는 primary·fallback 어디서도 불리지 않는다.
      expect(claudeProvider.complete).not.toHaveBeenCalled();
    });
  });

  describe('직무 계약 머리말 주입', () => {
    beforeEach(() => {
      chatgptProvider.complete.mockResolvedValue({
        text: 'ok',
        modelUsed: 'codex-cli',
        provider: ModelProviderName.CHATGPT,
      });
    });

    const sentPrompt = (): string =>
      (chatgptProvider.complete.mock.calls[0][0] as { prompt: string }).prompt;

    it('정밀 계약 에이전트는 산출물 규격과 근거 요구가 프롬프트 앞에 붙는다', async () => {
      await usecase.route({
        agentType: AgentType.PM,
        request: { prompt: 'hi' },
      });

      const prompt = sentPrompt();
      expect(prompt).toContain('[사규]');
      expect(prompt).toContain('topPriority');
      expect(prompt).toContain('근거');
      // 머리말은 앞에 붙고 원문은 그대로 뒤에 남는다.
      expect(prompt.endsWith('hi')).toBe(true);
    });

    it('스텁 계약 에이전트는 아무것도 붙이지 않는다', async () => {
      await usecase.route({
        agentType: AgentType.PO_SHADOW,
        request: { prompt: 'hi' },
      });

      expect(sentPrompt()).toBe('hi');
    });

    it('noContractPreamble 이면 계약이 있어도 붙이지 않는다', async () => {
      // IntentClassifier·ConversationalReply 가 provider 선택을 위해 PM 을 빌려 쓰는 경로 —
      // 계약의 산출물 규격이 붙으면 고정 JSON 스키마·대화 응답 지시와 충돌한다.
      await usecase.route({
        agentType: AgentType.PM,
        request: { prompt: 'hi' },
        noContractPreamble: true,
      });

      expect(sentPrompt()).toBe('hi');
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

  describe('probeReadiness (절전 직후 실행 게이트용)', () => {
    it('primary(CHATGPT) provider 의 probeReadiness 결과를 위임한다 (true)', async () => {
      chatgptProvider.probeReadiness = jest.fn().mockResolvedValue(true);

      await expect(usecase.probeReadiness()).resolves.toBe(true);
      expect(chatgptProvider.probeReadiness).toHaveBeenCalledTimes(1);
    });

    it('probeReadiness 가 false 면 false 를 위임한다', async () => {
      chatgptProvider.probeReadiness = jest.fn().mockResolvedValue(false);

      await expect(usecase.probeReadiness()).resolves.toBe(false);
    });

    it('provider 가 probeReadiness 를 구현하지 않으면 준비됨(true)으로 간주한다', async () => {
      // createProviderMock 은 probeReadiness 를 두지 않음(undefined).
      expect(chatgptProvider.probeReadiness).toBeUndefined();

      await expect(usecase.probeReadiness()).resolves.toBe(true);
    });
  });

  // 2026-07-18 / 07-26 관측 — 단일 실행이 약 32분(이론상 최대 6분)까지 늘어나 BullMQ lock
  // (450s)을 넘겼고, stalled 재처리로 같은 cron 이 하루 12~21회 중복 실행됐다. 당시 남은 기록은
  // "모델 호출 실패 (CHATGPT)" 뿐이라 그 32분이 route() 안인지 밖(context 수집·Notion 적재)인지
  // 가릴 수 없었다. 실패 메시지에 route 소요시간을 실어 AgentRun.output 으로 보존한다.
  describe('실패 진단 — route 소요시간 보존', () => {
    it('실패 메시지에 route 소요시간을 남긴다', async () => {
      chatgptProvider.complete.mockRejectedValue(
        new Error('codex CLI 응답 시간 초과 (180000ms)'),
      );

      let caught: Error | undefined;
      try {
        await usecase.route({
          agentType: AgentType.PM,
          request: { prompt: 'x' },
        });
      } catch (error) {
        caught = error as Error;
      }

      expect(caught?.message).toMatch(/모델 호출 실패 \(CHATGPT, \d+s 소요\)/);
    });

    it('쿼터 안내가 붙어도 소요시간은 함께 남는다', async () => {
      chatgptProvider.complete.mockRejectedValue(
        new CodexQuotaExceededException('2026-07-31 14:00'),
      );

      let caught: Error | undefined;
      try {
        await usecase.route({
          agentType: AgentType.PM,
          request: { prompt: 'x' },
        });
      } catch (error) {
        caught = error as Error;
      }

      expect(caught?.message).toMatch(/\d+s 소요/);
      expect(caught?.message).toContain('사용량 한도 초과');
    });

    // 2026-07-26 아침 브리핑 12건은 전부 SUCCEEDED 인데도 건당 약 32분이 걸렸다.
    // 실패 메시지 경로로는 이런 "성공했지만 비정상적으로 느린" 실행을 잡을 수 없으므로
    // 성공 경로에도 임계 경고를 둔다 (임계 = route 이론상 최대치).
    it('성공했더라도 이론상 최대치를 넘기면 경고를 남긴다', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const nowSpy = jest
        .spyOn(Date, 'now')
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(MODEL_ROUTER_WORST_CASE_MS + 1_000);
      chatgptProvider.complete.mockResolvedValue({
        text: 'ok',
        modelUsed: 'codex-cli',
        provider: ModelProviderName.CHATGPT,
      });

      await usecase.route({
        agentType: AgentType.PM,
        request: { prompt: 'x' },
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('이론상 최대치를 초과'),
      );
      warnSpy.mockRestore();
      nowSpy.mockRestore();
    });

    // PR #182 리뷰 지적 — 임계가 timeout×attempts(360s)뿐이면, 두 attempt 가 모두
    // 정상 timeout 되고 그 사이 backoff(최대 1,999ms)만 끼어도 임계를 넘겨 "timeout 이
    // 동작하지 않았을 수 있습니다" 라는 거짓 경고가 난다. 정상 경로는 조용해야 한다.
    it('두 attempt 가 모두 정상 timeout 되고 backoff 가 끼어도 경고하지 않는다', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      // 모든 timeout·backoff 가 정상 동작한 최악 경로 (backoff 는 base + jitter 상한 직전).
      const allTimeoutsHonoredMs =
        LLM_CLI_MAX_ATTEMPTS * LLM_CLI_TIMEOUT_MS +
        (LLM_CLI_MAX_ATTEMPTS - 1) *
          (LLM_CLI_RETRY_BACKOFF_BASE_MS + LLM_CLI_RETRY_BACKOFF_JITTER_MS - 1);
      const nowSpy = jest
        .spyOn(Date, 'now')
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(allTimeoutsHonoredMs);
      chatgptProvider.complete.mockResolvedValue({
        text: 'ok',
        modelUsed: 'codex-cli',
        provider: ModelProviderName.CHATGPT,
      });

      await usecase.route({
        agentType: AgentType.PM,
        request: { prompt: 'x' },
      });

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
      nowSpy.mockRestore();
    });

    it('정상 속도의 성공 호출은 경고하지 않는다', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      chatgptProvider.complete.mockResolvedValue({
        text: 'ok',
        modelUsed: 'codex-cli',
        provider: ModelProviderName.CHATGPT,
      });

      await usecase.route({
        agentType: AgentType.PM,
        request: { prompt: 'x' },
      });

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
