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

  it('PO_EVAL 성공 시 요약은 summaryText, 근거(careerLog·합성 source)는 detailText 로 분리(skip=false)', async () => {
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
    expect(out.summaryText).toContain('Daily Eval');
    expect(out.summaryText).toContain('회고요약');
    // 근거(합성 source · careerLog · model 푸터)는 스레드(detailText)로 내려가고 메인에는 없다.
    expect(out.summaryText).not.toContain('합성 source');
    expect(out.detailText).toContain('합성 source');
    expect(out.detailText).toContain('workReviewer=#10');
    expect(out.detailText).toContain('careerLog');
    expect(out.detailText).toContain('run #50');
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
    expect(out.summaryText).toContain('skip');
  });

  it('그 외 에러는 throw (consumer 가 실패 통지)', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    const task = new PoEvalAutopilotTask({ execute } as never);
    await expect(task.run(CTX)).rejects.toThrow('boom');
  });
});
