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
      today: { year: 2026, month: 6, day: 16 },
    });

    expect(outcome.result.status).toBe('SCREENING');
    // 비종료 전환 → 팔로업 클럭을 today + 7 로 리셋.
    expect(repository.updateStatusByCompany).toHaveBeenCalledWith({
      slackUserId: 'U1',
      companyRef: '토스',
      status: 'SCREENING',
      nextFollowUpAt: { year: 2026, month: 6, day: 23 },
    });
  });

  it('종료 상태(OFFER)로 전환 시 nextFollowUpAt=null 로 더 넛지하지 않음', async () => {
    const repository = {
      updateStatusByCompany: jest.fn().mockResolvedValue({
        id: 1,
        company: '토스',
        role: '백엔드',
        status: 'OFFER',
      }),
    };
    const usecase = new UpdateApplicationUsecase(
      repository as never,
      makeAgentRun() as never,
    );

    await usecase.execute({
      slackUserId: 'U1',
      ref: '토스',
      status: 'OFFER',
      today: { year: 2026, month: 6, day: 16 },
    });

    expect(repository.updateStatusByCompany).toHaveBeenCalledWith({
      slackUserId: 'U1',
      companyRef: '토스',
      status: 'OFFER',
      nextFollowUpAt: null,
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
      usecase.execute({
        slackUserId: 'U1',
        ref: '없는회사',
        status: 'OFFER',
        today: { year: 2026, month: 6, day: 16 },
      }),
    ).rejects.toBeInstanceOf(JobApplicationException);
  });
});
