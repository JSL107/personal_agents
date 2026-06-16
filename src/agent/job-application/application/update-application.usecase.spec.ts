import { JobApplicationException } from '../domain/job-application.exception';
import { UpdateApplicationUsecase } from './update-application.usecase';

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
      const r = await run({ agentRunId: 9 });
      return { result: r.result, modelUsed: r.modelUsed, agentRunId: 9 };
    },
  ),
});

describe('UpdateApplicationUsecase', () => {
  it('updateStatusByCompany 결과 반환', async () => {
    const repository = {
      updateStatusByCompany: jest.fn().mockResolvedValue({
        id: 1,
        company: '토스',
        role: '백엔드',
        status: 'SCREENING',
      }),
    };
    const usecase = new UpdateApplicationUsecase(
      repository as never,
      makeAgentRun() as never,
    );

    const outcome = await usecase.execute({
      slackUserId: 'U1',
      ref: '토스',
      status: 'SCREENING',
    });

    expect(outcome.result.status).toBe('SCREENING');
    expect(repository.updateStatusByCompany).toHaveBeenCalledWith({
      slackUserId: 'U1',
      companyRef: '토스',
      status: 'SCREENING',
    });
  });

  it('매칭 없으면 NOT_FOUND 예외', async () => {
    const repository = {
      updateStatusByCompany: jest.fn().mockResolvedValue(null),
    };
    const usecase = new UpdateApplicationUsecase(
      repository as never,
      makeAgentRun() as never,
    );

    await expect(
      usecase.execute({ slackUserId: 'U1', ref: '없는회사', status: 'OFFER' }),
    ).rejects.toBeInstanceOf(JobApplicationException);
  });
});
