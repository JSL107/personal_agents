import { Logger } from '@nestjs/common';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import {
  AgentType,
  ModelProviderName,
} from '../../model-router/domain/model-router.type';
import { PreferenceProfilePort } from '../../preference-profile/domain/port/preference-profile.port';
import { INTENT_CLASSIFIER_SYSTEM_PROMPT } from '../domain/prompt/intent-classifier-system.prompt';
import { IntentClassifierUsecase } from './intent-classifier.usecase';

const makeModelRouterMock = (
  responseText: string,
): jest.Mocked<ModelRouterUsecase> =>
  ({
    route: jest.fn().mockResolvedValue({
      text: responseText,
      modelUsed: 'gpt-5-mock',
      provider: ModelProviderName.CHATGPT,
    }),
  }) as unknown as jest.Mocked<ModelRouterUsecase>;

describe('IntentClassifierUsecase', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('LLM 응답을 IntentClassification 으로 반환', async () => {
    const modelRouter = makeModelRouterMock(
      JSON.stringify({
        agentType: 'BE',
        confidence: 0.85,
        reason: '구현 요청',
      }),
    );
    const usecase = new IntentClassifierUsecase(modelRouter);

    const result = await usecase.classify(
      '백엔드에서 user repository 만들어줘',
    );

    expect(result.agentType).toBe(AgentType.BE);
    expect(result.confidence).toBe(0.85);
    expect(result.reason).toBe('구현 요청');
  });

  it('ModelRouter.route 가 AgentType.PM 의 provider 와 system prompt 로 호출된다', async () => {
    const modelRouter = makeModelRouterMock(
      JSON.stringify({ agentType: 'PM', confidence: 0.9, reason: '' }),
    );
    const usecase = new IntentClassifierUsecase(modelRouter);

    await usecase.classify('  오늘 plan  ');

    expect(modelRouter.route).toHaveBeenCalledWith({
      agentType: AgentType.PM,
      request: {
        prompt: '오늘 plan',
        systemPrompt: INTENT_CLASSIFIER_SYSTEM_PROMPT,
      },
    });
  });

  it('UNKNOWN 도 정상 반환 — manager 가 자체 분기 처리', async () => {
    const modelRouter = makeModelRouterMock(
      JSON.stringify({
        agentType: 'UNKNOWN',
        confidence: 0,
        reason: '의도 모호',
      }),
    );
    const usecase = new IntentClassifierUsecase(modelRouter);

    const result = await usecase.classify('어쩌고 저쩌고');

    expect(result.agentType).toBe('UNKNOWN');
  });

  describe('episodic few-shot 주입', () => {
    const beResponse = JSON.stringify({
      agentType: 'BE',
      confidence: 0.9,
      reason: 'r',
    });

    it('episodic 주입 시 [유사 과거 작업] 섹션을 프롬프트에 포함한다', async () => {
      const modelRouter = makeModelRouterMock(beResponse);
      const episodic = {
        record: jest.fn(),
        searchRelevant: jest.fn().mockResolvedValue([
          {
            id: 1,
            agentRunId: 11,
            agentType: 'BE',
            content: '결제 모듈 PG 리팩토링',
            score: 0.8,
            occurredAt: new Date(),
          },
        ]),
      };
      const usecase = new IntentClassifierUsecase(
        modelRouter,
        episodic as never,
      );

      await usecase.classify('PG 연동 손봐줘');

      expect(episodic.searchRelevant).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'agent_run', limit: 3 }),
      );
      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt).toContain('[유사 과거 작업]');
      expect(prompt).toContain('worker BE');
    });

    it('episodic 미주입 시 기존 프롬프트(섹션 없음)로 분류한다', async () => {
      const modelRouter = makeModelRouterMock(beResponse);
      const usecase = new IntentClassifierUsecase(modelRouter, undefined);

      await usecase.classify('PG 연동 손봐줘');

      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt).not.toContain('[유사 과거 작업]');
    });

    it('episodic 검색이 throw 해도 분류는 정상 진행한다 (best-effort)', async () => {
      const modelRouter = makeModelRouterMock(beResponse);
      const episodic = {
        record: jest.fn(),
        searchRelevant: jest.fn().mockRejectedValue(new Error('embed down')),
      };
      const usecase = new IntentClassifierUsecase(
        modelRouter,
        episodic as never,
      );

      const result = await usecase.classify('PG 연동 손봐줘');

      expect(result.agentType).toBe(AgentType.BE);
      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt).not.toContain('[유사 과거 작업]');
    });
  });

  describe('preference profile routing 주입', () => {
    const beResponse = JSON.stringify({
      agentType: 'BE',
      confidence: 0.9,
      reason: 'r',
    });

    it('프로필 주입 시 systemPrompt 에 라우팅 힌트가 포함된다', async () => {
      const routingHint = '사용자 지칭 습관 힌트:\n- "그거 분배" → CTO';
      const preferenceProfile: PreferenceProfilePort = {
        getInjectionBlock: jest.fn().mockResolvedValue(routingHint),
      };
      const modelRouter = makeModelRouterMock(beResponse);
      const usecase = new IntentClassifierUsecase(
        modelRouter,
        undefined,
        preferenceProfile,
      );

      await usecase.classify('그거 분배해줘');

      const callArg = modelRouter.route.mock.calls[0][0];
      expect(callArg.request.systemPrompt).toContain(routingHint);
      expect(callArg.request.systemPrompt).toContain(
        INTENT_CLASSIFIER_SYSTEM_PROMPT,
      );
    });

    it('프로필 미주입 시 기존 systemPrompt 로 호출된다', async () => {
      const modelRouter = makeModelRouterMock(beResponse);
      const usecase = new IntentClassifierUsecase(
        modelRouter,
        undefined,
        undefined,
      );

      await usecase.classify('그거 분배해줘');

      const callArg = modelRouter.route.mock.calls[0][0];
      expect(callArg.request.systemPrompt).toBe(
        INTENT_CLASSIFIER_SYSTEM_PROMPT,
      );
    });
  });
});
