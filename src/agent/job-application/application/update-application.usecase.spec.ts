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
    expect(repository.updateStatusByCompany).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: 'U1',
        companyRef: '토스',
        status: 'SCREENING',
      }),
    );
    // 비종료 상태 → 팔로업 시계 리셋(미래 PlainDate, null 아님)
    const updateArg = repository.updateStatusByCompany.mock.calls[0][0];
    expect(updateArg.nextFollowUpAt).not.toBeNull();
    expect(typeof updateArg.nextFollowUpAt.year).toBe('number');
  });

  it('종료 상태(OFFER)로 변경 시 nextFollowUpAt 을 null 로 세팅', async () => {
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

    await usecase.execute({ slackUserId: 'U1', ref: '토스', status: 'OFFER' });

    const updateArg = repository.updateStatusByCompany.mock.calls[0][0];
    expect(updateArg.status).toBe('OFFER');
    expect(updateArg.nextFollowUpAt).toBeNull();
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
