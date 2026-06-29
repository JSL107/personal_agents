import { DeterministicDocsChecker } from './deterministic-docs.checker';

describe('DeterministicDocsChecker', () => {
  it('모든 명령 exit 0 이면 inSync=true', async () => {
    const runner = jest.fn().mockResolvedValue({ exitCode: 0, output: 'OK' });
    const checker = new DeterministicDocsChecker(runner);
    const report = await checker.check();
    expect(report.inSync).toBe(true);
    expect(report.details).toHaveLength(0);
  });

  it('docs:check 가 exit 1 이면 inSync=false + 사유 수집', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce({
        exitCode: 1,
        output: 'FAIL: docs/agent-catalog.md',
      })
      .mockResolvedValueOnce({ exitCode: 0, output: 'OK' });
    const checker = new DeterministicDocsChecker(runner);
    const report = await checker.check();
    expect(report.inSync).toBe(false);
    expect(report.details[0]).toContain('docs:check');
  });
});
