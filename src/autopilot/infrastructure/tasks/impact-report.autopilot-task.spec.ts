import { ImpactReporterException } from '../../../agent/impact-reporter/domain/impact-reporter.exception';
import { ImpactReporterErrorCode } from '../../../agent/impact-reporter/domain/impact-reporter-error-code.enum';
import { ImpactReportAutopilotTask } from './impact-report.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };
const noConfig = { get: jest.fn().mockReturnValue(undefined) };

describe('ImpactReportAutopilotTask', () => {
  it('id 는 impact-report', () => {
    expect(
      new ImpactReportAutopilotTask({} as never, noConfig as never).id,
    ).toBe('impact-report');
  });

  it('RECENT_MODE_NO_RESULTS 면 graceful skip 안내(skip=false)', async () => {
    const execute = jest.fn().mockRejectedValue(
      new ImpactReporterException({
        code: ImpactReporterErrorCode.RECENT_MODE_NO_RESULTS,
        message: '0건',
        status: 502,
      } as never),
    );
    const task = new ImpactReportAutopilotTask(
      { execute } as never,
      noConfig as never,
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.slackText).toContain('skip');
  });

  it('RECENT_MODE_ENV_MISSING 면 graceful 안내(skip=false)', async () => {
    const execute = jest.fn().mockRejectedValue(
      new ImpactReporterException({
        code: ImpactReporterErrorCode.RECENT_MODE_ENV_MISSING,
        message: 'env 누락',
        status: 500,
      } as never),
    );
    const task = new ImpactReportAutopilotTask(
      { execute } as never,
      noConfig as never,
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.slackText).toContain('IMPACT_REPORT_GITHUB_AUTHOR');
  });

  it('그 외 에러는 throw', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(
      new ImpactReportAutopilotTask(
        { execute } as never,
        noConfig as never,
      ).run(CTX),
    ).rejects.toThrow('boom');
  });
});
