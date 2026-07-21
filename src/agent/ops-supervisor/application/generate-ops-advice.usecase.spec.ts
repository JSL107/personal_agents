import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { CodexQuotaExceededException } from '../../../model-router/infrastructure/codex-cli.provider';
import { GenerateOpsAdviceUsecase } from './generate-ops-advice.usecase';

describe('GenerateOpsAdviceUsecase', () => {
  const createAgentRunService = () => ({
    execute: jest.fn().mockImplementation(async ({ run }) => {
      const execution = await run({ agentRunId: 42 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 42,
      };
    }),
  });

  it('modelRouter.route 결과 텍스트를 반환한다', async () => {
    const route = jest
      .fn()
      .mockResolvedValue({ text: '- PM 실패율: 인증 만료 의심' });
    const agentRunService = createAgentRunService();
    const usecase = new GenerateOpsAdviceUsecase(
      { route } as unknown as ModelRouterUsecase,
      agentRunService as unknown as AgentRunService,
    );

    const result = await usecase.advise({
      anomaliesSummary: 'PM 실패율 30%',
    });

    expect(result).toContain('PM');
    expect(route.mock.calls[0][0].agentType).toBe('OPS_SUPERVISOR');
    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'OPS_SUPERVISOR',
        triggerType: TriggerType.SCHEDULED,
        inputSnapshot: { anomaliesSummary: 'PM 실패율 30%' },
      }),
    );
  });

  it('직접 발생한 쿼터 예외는 그대로 전파한다', async () => {
    const quota = new CodexQuotaExceededException('내일');
    const route = jest.fn().mockRejectedValue(quota);
    const usecase = new GenerateOpsAdviceUsecase(
      { route } as unknown as ModelRouterUsecase,
      createAgentRunService() as unknown as AgentRunService,
    );

    await expect(usecase.advise({ anomaliesSummary: 'x' })).rejects.toBe(quota);
  });

  it('ModelRouterException cause에 감싼 쿼터 예외를 추출해 전파한다', async () => {
    const quota = new CodexQuotaExceededException('내일');
    const wrapped = Object.assign(new Error('모델 호출 실패'), {
      cause: { primaryError: quota, lastError: quota },
    });
    const route = jest.fn().mockRejectedValue(wrapped);
    const usecase = new GenerateOpsAdviceUsecase(
      { route } as unknown as ModelRouterUsecase,
      createAgentRunService() as unknown as AgentRunService,
    );

    await expect(usecase.advise({ anomaliesSummary: 'x' })).rejects.toBe(quota);
  });
});
