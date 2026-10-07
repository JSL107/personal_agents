import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { FactAnswerUsecase } from '../../../fact-answer/application/fact-answer.usecase';
import { LeaveUsagePrismaRepository } from '../infrastructure/leave-usage.prisma.repository';
import { AnswerVacationQuestionUsecase } from './answer-vacation-question.usecase';

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const usage = (id: number, iso: string, businessDays: number) => {
  const [year, month, day] = iso.split('-').map(Number);
  return {
    id,
    slackUserId: 'U1',
    startDate: { year, month, day },
    endDate: { year, month, day },
    businessDays,
    memo: null,
    createdAt: new Date(`${iso}T00:00:00.000Z`),
  };
};

describe('AnswerVacationQuestionUsecase', () => {
  const run = async (hireDate: string, usages: ReturnType<typeof usage>[]) => {
    const execute = jest.fn(async (input) => {
      const r = await input.run({ agentRunId: 21 });
      return {
        result: r.result,
        modelUsed: r.modelUsed,
        agentRunId: 21,
        output: r.output,
      };
    });
    const answer = jest.fn().mockResolvedValue({
      text: '답',
      usedFallback: false,
      modelUsed: 'codex-cli',
      numberCheck: { ok: true, unexpected: [] },
    });
    const usecase = new AnswerVacationQuestionUsecase(
      config({ VACATION_HIRE_DATE: hireDate }),
      {
        findActiveByUser: jest.fn().mockResolvedValue(usages),
      } as unknown as LeaveUsagePrismaRepository,
      { execute } as unknown as AgentRunService,
      { answer } as unknown as FactAnswerUsecase,
    );
    const outcome = await usecase.execute({
      slackUserId: 'U1',
      asOf: { year: 2026, month: 10, day: 7 },
      text: '작년보다 많이 썼어?',
      priorTurns: [],
      parsedIntent: { action: 'UNKNOWN' },
    });
    return { outcome, execute, answer };
  };

  it('원장에는 잔여 조회가 아니라 UNKNOWN 회차로 남기고, 사실·답·숫자 검사를 함께 적는다', async () => {
    const { outcome, execute } = await run('2024-01-15', [
      usage(1, '2026-03-02', 1),
    ]);

    expect(execute.mock.calls[0][0].inputSnapshot).toMatchObject({
      action: 'UNKNOWN',
      parsedIntent: { action: 'UNKNOWN' },
    });
    expect(outcome.agentRunId).toBe(21);
    expect(outcome.result.text).toBe('답');
    const output = (outcome as unknown as { output: Record<string, unknown> })
      .output;
    expect(output).toMatchObject({
      reply: '답',
      usedFallback: false,
      numberCheck: { ok: true },
    });
  });

  it('현재·직전 회기와 사용 내역을 사실로 넘긴다 — 비교 질문의 근거', async () => {
    const { answer } = await run('2024-01-15', [
      usage(1, '2025-06-02', 1),
      usage(2, '2026-03-02', 0.5),
    ]);

    const facts = answer.mock.calls[0][0].facts;
    expect(facts.currentPeriod).toMatchObject({
      start: '2026-01-15',
      used: 0.5,
    });
    expect(facts.previousPeriod).toMatchObject({
      start: '2025-01-15',
      used: 1,
    });
    expect(facts.usages).toHaveLength(2);
    expect(facts.howToChange).toContain('VACATION_FIRST_YEAR_ADVANCE_DAYS');
    // 답을 못 만들면 내보낼 결정론 요약도 함께 넘긴다.
    expect(answer.mock.calls[0][0].fallbackText).toContain('휴가 잔여');
  });

  it('입사 첫 회기면 직전 회기는 없다', async () => {
    const { answer } = await run('2026-04-06', []);
    expect(answer.mock.calls[0][0].facts.previousPeriod).toBeNull();
  });
});
