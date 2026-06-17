import { PoEvalException } from '../../../agent/po-eval/domain/po-eval.exception';
import { PoEvalErrorCode } from '../../../agent/po-eval/domain/po-eval-error-code.enum';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { PoEvalAutopilotTask } from './po-eval.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };

describe('PoEvalAutopilotTask', () => {
  it('id 는 daily-eval', () => {
    const task = new PoEvalAutopilotTask({} as never);
    expect(task.id).toBe('daily-eval');
  });

  it('PO_EVAL 성공 시 slackText 반환(skip=false)', async () => {
    const execute = jest.fn().mockResolvedValue({
      result: {
        range: 'TODAY',
        sourceAgentRuns: { workReviewerRunId: 10 },
        qualitative: { summary: '회고요약', blockers: [], wins: [] },
        careerLog: {
          schemaVersion: 1,
          period: '2026-06-17',
          achievements: { quantitative: [], qualitative: [] },
          technologies: [],
          impact: '오늘 핵심 활동.',
        },
      },
      modelUsed: 'claude-cli',
      agentRunId: 50,
    });
    const task = new PoEvalAutopilotTask({ execute } as never);

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.slackText).toContain('Daily Eval');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1', range: 'TODAY' }),
    );
  });

  it('NO_SUB_AGENT_RUNS 면 skip 안내문(skip=false)', async () => {
    const execute = jest.fn().mockRejectedValue(
      new PoEvalException({
        code: PoEvalErrorCode.NO_SUB_AGENT_RUNS,
        message: '없음',
        status: DomainStatus.NOT_FOUND,
      }),
    );
    const task = new PoEvalAutopilotTask({ execute } as never);

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.slackText).toContain('skip');
  });

  it('그 외 에러는 throw (consumer 가 실패 통지)', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    const task = new PoEvalAutopilotTask({ execute } as never);
    await expect(task.run(CTX)).rejects.toThrow('boom');
  });
});
