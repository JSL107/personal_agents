import { ImpactReporterException } from '../../../agent/impact-reporter/domain/impact-reporter.exception';
import { ImpactReporterErrorCode } from '../../../agent/impact-reporter/domain/impact-reporter-error-code.enum';
import { ImpactReportAutopilotTask } from './impact-report.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };
const noConfig = { get: jest.fn().mockReturnValue(undefined) };

const makeOutcome = () => ({
  result: {
    subject: 'feat: 테스트',
    headline: '주요 PR 1건 머지',
    quantitative: ['PR 1건'],
    qualitative: '코드 품질 개선',
    affectedAreas: { users: [], team: [], service: [] },
    risks: [],
    beforeAfter: null,
    reasoning: '근거',
  },
  modelUsed: 'codex-cli',
  agentRunId: 1,
});

const makeHumanizeService = () => ({
  humanize: jest
    .fn()
    .mockImplementation((fields: Record<string, string>) =>
      Promise.resolve(fields),
    ),
});

describe('ImpactReportAutopilotTask', () => {
  it('id 는 impact-report', () => {
    expect(
      new ImpactReportAutopilotTask({} as never, noConfig as never, {} as never)
        .id,
    ).toBe('impact-report');
  });

  it('정상 경로: summaryText=헤더+summary, detailText=detail+footer, 윤문 호출됨', async () => {
    const outcome = makeOutcome();
    const execute = jest.fn().mockResolvedValue(outcome);
    const humanizeService = makeHumanizeService();
    const task = new ImpactReportAutopilotTask(
      { execute } as never,
      noConfig as never,
      humanizeService as never,
    );

    const result = await task.run(CTX);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('📊 *Impact Report —');
    expect(result.summaryText).toContain('2026-06-17');
    expect(result.summaryText).not.toContain('판단 근거'); // detail 내용은 summaryText 에 없음
    expect(result.detailText).toBeDefined();
    expect(result.detailText).toContain('판단 근거'); // detail 섹션
    expect(result.detailText).toContain('run #1'); // footer
    expect(humanizeService.humanize).toHaveBeenCalled();
  });

  it('RECENT_MODE_NO_RESULTS 면 graceful skip 안내(skip=false, detailText 없음)', async () => {
    const execute = jest.fn().mockRejectedValue(
      new ImpactReporterException({
        code: ImpactReporterErrorCode.RECENT_MODE_NO_RESULTS,
        message: '0건',
        status: 502,
      } as never),
    );
    const humanizeService = makeHumanizeService();
    const task = new ImpactReportAutopilotTask(
      { execute } as never,
      noConfig as never,
      humanizeService as never,
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('skip');
    expect(out.detailText).toBeUndefined();
  });

  it('RECENT_MODE_ENV_MISSING 면 graceful 안내(skip=false, detailText 없음)', async () => {
    const execute = jest.fn().mockRejectedValue(
      new ImpactReporterException({
        code: ImpactReporterErrorCode.RECENT_MODE_ENV_MISSING,
        message: 'env 누락',
        status: 500,
      } as never),
    );
    const humanizeService = makeHumanizeService();
    const task = new ImpactReportAutopilotTask(
      { execute } as never,
      noConfig as never,
      humanizeService as never,
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('IMPACT_REPORT_GITHUB_AUTHOR');
    expect(out.detailText).toBeUndefined();
  });

  it('그 외 에러는 throw', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(
      new ImpactReportAutopilotTask(
        { execute } as never,
        noConfig as never,
        {} as never,
      ).run(CTX),
    ).rejects.toThrow('boom');
  });
});
