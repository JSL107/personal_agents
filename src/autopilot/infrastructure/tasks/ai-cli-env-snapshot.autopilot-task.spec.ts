import { AiCliEnvPort } from '../../../ai-cli-env/domain/port/ai-cli-env.port';
import { AiCliEnvSnapshotAutopilotTask } from './ai-cli-env-snapshot.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-12' };

const buildPort = (overrides: Partial<AiCliEnvPort> = {}): AiCliEnvPort => ({
  isEnabled: jest.fn().mockReturnValue(true),
  ensureRepository: jest.fn(),
  exportSnapshot: jest
    .fn()
    .mockResolvedValue({ changed: false, pushed: false }),
  readStatus: jest.fn(),
  applySnapshot: jest.fn(async (expectedSha: string) => {
    void expectedSha;
    return { appliedSha: 'snapshot-sha', output: '', warnings: [] };
  }),
  ...overrides,
});

describe('AiCliEnvSnapshotAutopilotTask', () => {
  it('동기화 repo 미설정이면 export 없이 skip 한다', async () => {
    const port = buildPort({ isEnabled: jest.fn().mockReturnValue(false) });
    const task = new AiCliEnvSnapshotAutopilotTask(port);

    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(port.exportSnapshot).not.toHaveBeenCalled();
  });

  it('스냅샷 변경이 없으면 skip 한다', async () => {
    const task = new AiCliEnvSnapshotAutopilotTask(buildPort());

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  it('스냅샷 변경이 있으면 Claude와 Codex 요약을 발송한다', async () => {
    const port = buildPort({
      exportSnapshot: jest
        .fn()
        .mockResolvedValue({ changed: true, pushed: true }),
      readStatus: jest.fn().mockResolvedValue({
        available: true,
        summary: {
          sourceHome: '/Users/source',
          generatedAt: '2026-08-12T01:00:00.000Z',
          claude: { plugins: 2, mcpServers: 3, assets: 4 },
          codex: { plugins: 5, mcpServers: 6, assets: 7 },
        },
      }),
    });
    const task = new AiCliEnvSnapshotAutopilotTask(port);

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('Claude 플러그인 2·MCP 3');
    expect(result.summaryText).toContain('Codex 플러그인 5·MCP 6');
  });

  it('port 오류는 삼키지 않고 전파한다', async () => {
    const error = new Error('git push failed');
    const task = new AiCliEnvSnapshotAutopilotTask(
      buildPort({ exportSnapshot: jest.fn().mockRejectedValue(error) }),
    );

    await expect(task.run(context)).rejects.toBe(error);
  });
});
