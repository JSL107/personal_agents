import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { ProposeReelsFormatUsecase } from './propose-reels-format.usecase';

describe('ProposeReelsFormatUsecase', () => {
  const createAgentRunService = () => ({
    execute: jest.fn().mockImplementation(async ({ run }) => {
      const execution = await run();
      return { result: execution.result, modelUsed: execution.modelUsed };
    }),
  });

  it('후보가 둘이면 enum 스키마와 경계 마커를 전달하고 해석을 반환한다', async () => {
    const route = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        candidateId: 'early_card=true',
        hypothesis: '첫 화면 개선',
        interpretation: '스킵률이 낮아졌다.',
      }),
      modelUsed: 'codex',
    });
    const agentRunService = createAgentRunService();
    const usecase = new ProposeReelsFormatUsecase(
      { route } as unknown as ModelRouterUsecase,
      agentRunService as unknown as AgentRunService,
    );

    const result = await usecase.propose({
      statsSummary: '스킵률 60%',
      candidateIds: ['early_card=true', 'first_line="a"'],
      reverseChallenge: false,
    });

    expect(result.candidateId).toBe('early_card=true');
    expect(result.interpretation).toBe('스킵률이 낮아졌다.');
    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: TriggerType.REELS_FORMAT_DECISION,
      }),
    );
    expect(route).toHaveBeenCalledWith(
      expect.objectContaining({
        noContractPreamble: true,
        request: expect.objectContaining({
          prompt: expect.stringContaining('<experiment-data>'),
          outputSchema: expect.objectContaining({
            required: ['candidateId', 'hypothesis', 'interpretation'],
            properties: expect.objectContaining({
              candidateId: {
                type: 'string',
                enum: ['early_card=true', 'first_line="a"'],
              },
            }),
          }),
        }),
      }),
    );
  });

  it('후보가 하나면 candidateId를 요구하지 않는 스키마를 사용한다', async () => {
    const route = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        hypothesis: '다음 확인',
        interpretation: '유지한다.',
      }),
      modelUsed: 'codex',
    });
    const usecase = new ProposeReelsFormatUsecase(
      { route } as unknown as ModelRouterUsecase,
      createAgentRunService() as unknown as AgentRunService,
    );

    const result = await usecase.propose({
      statsSummary: '요약',
      candidateIds: ['early_card=true'],
      reverseChallenge: false,
    });

    expect(result.candidateId).toBeUndefined();
    expect(route.mock.calls[0][0].request.outputSchema.required).toEqual([
      'hypothesis',
      'interpretation',
    ]);
  });

  it('역도전이면 후보가 둘이어도 candidateId를 요구하지 않고 후보 목록은 전달한다', async () => {
    const route = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        hypothesis: '역도전',
        interpretation: '다시 확인한다.',
      }),
      modelUsed: 'codex',
    });
    const usecase = new ProposeReelsFormatUsecase(
      { route } as unknown as ModelRouterUsecase,
      createAgentRunService() as unknown as AgentRunService,
    );

    await usecase.propose({
      statsSummary: '요약',
      candidateIds: ['early_card=false', 'first_line="a"'],
      reverseChallenge: true,
    });

    expect(route.mock.calls[0][0].request.prompt).toContain('early_card=false');
    expect(route.mock.calls[0][0].request.outputSchema.required).toEqual([
      'hypothesis',
      'interpretation',
    ]);
  });
});
