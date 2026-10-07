import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { FactAnswerUsecase } from '../../../fact-answer/application/fact-answer.usecase';
import { JobApplicationRepositoryPort } from '../domain/port/job-application.repository.port';
import { AnswerJobQuestionUsecase } from './answer-job-question.usecase';

const record = (company: string, month: number, status = 'APPLIED') => ({
  id: month,
  slackUserId: 'U1',
  company,
  role: '백엔드',
  jdUrl: null,
  status,
  appliedAt: { year: 2026, month, day: 3 },
  deadline: null,
  nextFollowUpAt: null,
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

describe('AnswerJobQuestionUsecase', () => {
  it('지원 기록·이번 달 지원 수·상태별 건수를 사실로 넘기고, UNKNOWN 회차로 원장에 남긴다', async () => {
    const execute = jest.fn(async (input) => {
      const r = await input.run({ agentRunId: 31 });
      return { result: r.result, modelUsed: r.modelUsed, agentRunId: 31 };
    });
    const answer = jest.fn().mockResolvedValue({
      text: '이번 달에는 1곳에 지원했어요.',
      usedFallback: false,
      modelUsed: 'codex-cli',
    });
    const usecase = new AnswerJobQuestionUsecase(
      {
        listByUser: jest
          .fn()
          .mockResolvedValue([
            record('토스', 10),
            record('당근', 9, 'INTERVIEW'),
          ]),
      } as unknown as JobApplicationRepositoryPort,
      { execute } as unknown as AgentRunService,
      { answer } as unknown as FactAnswerUsecase,
    );

    const outcome = await usecase.execute({
      slackUserId: 'U1',
      today: { year: 2026, month: 10, day: 7 },
      text: '이번 달에 몇 개 지원했어?',
      priorTurns: [],
      parsedIntent: { action: 'UNKNOWN' },
    });

    expect(execute.mock.calls[0][0].inputSnapshot).toMatchObject({
      action: 'UNKNOWN',
    });
    const facts = answer.mock.calls[0][0].facts;
    expect(facts).toMatchObject({
      total: 2,
      appliedThisMonth: 1,
      countsByStatus: { APPLIED: 1, INTERVIEW: 1 },
    });
    expect(outcome.result.text).toBe('이번 달에는 1곳에 지원했어요.');
  });
});
