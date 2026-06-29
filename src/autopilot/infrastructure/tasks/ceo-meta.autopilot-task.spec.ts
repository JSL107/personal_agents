import { CeoException } from '../../../agent/ceo/domain/ceo.exception';
import { CeoErrorCode } from '../../../agent/ceo/domain/ceo-error-code.enum';
import { CeoMetaAutopilotTask } from './ceo-meta.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };

const makeOutcome = () => ({
  result: {
    range: 'WEEK' as const,
    finalSummary: '이번 주 팀 방향성 점검 완료',
    contextDriftReport: {
      observations: ['관찰 사항 1'],
    },
    docsQualityReport: {
      findings: ['문서 품질 개선 필요'],
    },
    sourcePhaseRuns: {
      poEvalRunId: 10,
      pmRunId: 11,
      ctoRunId: 12,
    },
    schemaVersion: 1,
  },
  modelUsed: 'claude-cli',
  agentRunId: 5,
});

const makeHumanizeService = () => ({
  humanize: jest
    .fn()
    .mockImplementation((fields: Record<string, string>) =>
      Promise.resolve(fields),
    ),
});

describe('CeoMetaAutopilotTask', () => {
  it('id 는 ceo-meta', () => {
    expect(new CeoMetaAutopilotTask({} as never, {} as never).id).toBe(
      'ceo-meta',
    );
  });

  it('정상 경로: summaryText=헤더+summary, detailText=detail+footer, 윤문 호출됨', async () => {
    const outcome = makeOutcome();
    const execute = jest.fn().mockResolvedValue(outcome);
    const humanizeService = makeHumanizeService();
    const task = new CeoMetaAutopilotTask(
      { execute } as never,
      humanizeService as never,
    );

    const result = await task.run(CTX);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('🧭 *CEO Meta —');
    expect(result.summaryText).toContain('2026-06-17');
    expect(result.summaryText).not.toContain('컨텍스트 드리프트'); // detail 내용은 summaryText 에 없음
    expect(result.detailText).toBeDefined();
    expect(result.detailText).toContain('컨텍스트 드리프트'); // detail 섹션
    expect(result.detailText).toContain('run #5'); // footer
    expect(humanizeService.humanize).toHaveBeenCalled();
  });

  it('NO_PO_EVAL_RUN 이면 graceful skip 안내(skip=false, detailText 없음)', async () => {
    const execute = jest.fn().mockRejectedValue(
      new CeoException({
        code: CeoErrorCode.NO_PO_EVAL_RUN,
        message: '없음',
        status: 502,
      } as never),
    );
    const humanizeService = makeHumanizeService();
    const task = new CeoMetaAutopilotTask(
      { execute } as never,
      humanizeService as never,
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('skip');
    expect(out.detailText).toBeUndefined();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1', range: 'WEEK' }),
    );
  });

  it('그 외 에러는 throw (consumer 가 실패 통지)', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(
      new CeoMetaAutopilotTask({ execute } as never, {} as never).run(CTX),
    ).rejects.toThrow('boom');
  });
});
