import { AddApplicationUsecase } from './add-application.usecase';

interface RunContext {
  agentRunId: number;
}
interface RunResult {
  result: unknown;
  modelUsed: string;
  output: unknown;
}

const makeAgentRun = () => ({
  execute: jest.fn(
    async ({ run }: { run: (c: RunContext) => Promise<RunResult> }) => {
      const r = await run({ agentRunId: 7 });
      return { result: r.result, modelUsed: r.modelUsed, agentRunId: 7 };
    },
  ),
});

describe('AddApplicationUsecase', () => {
  it('repository.save 호출 + 결과 반환', async () => {
    const repository = {
      save: jest.fn().mockResolvedValue({
        id: 1,
        company: '토스',
        role: '백엔드',
        status: 'APPLIED',
      }),
    };
    const agentRunService = makeAgentRun();
    const usecase = new AddApplicationUsecase(
      repository as never,
      agentRunService as never,
    );

    const outcome = await usecase.execute({
      slackUserId: 'U1',
      company: '토스',
      role: '백엔드',
      status: 'APPLIED',
      appliedAt: { year: 2026, month: 6, day: 16 },
    });

    expect(outcome.result.company).toBe('토스');
    expect(outcome.agentRunId).toBe(7);
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('status 미지정 시 APPLIED 기본값으로 저장', async () => {
    const repository = {
      save: jest.fn().mockResolvedValue({
        id: 2,
        company: '카카오',
        role: '서버',
        status: 'APPLIED',
      }),
    };
    const usecase = new AddApplicationUsecase(
      repository as never,
      makeAgentRun() as never,
    );

    await usecase.execute({
      slackUserId: 'U1',
      company: '카카오',
      role: '서버',
      appliedAt: { year: 2026, month: 6, day: 16 },
    });

    expect(repository.save.mock.calls[0][0].status).toBe('APPLIED');
  });
});
