import { Logger } from '@nestjs/common';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import {
  AgentType,
  ModelProviderName,
} from '../../model-router/domain/model-router.type';
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
});
