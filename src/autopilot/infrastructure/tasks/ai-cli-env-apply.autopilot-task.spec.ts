import { homedir, hostname } from 'node:os';

import { SnapshotStatus } from '../../../ai-cli-env/domain/ai-cli-env.type';
import { AiCliEnvPort } from '../../../ai-cli-env/domain/port/ai-cli-env.port';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { AiCliEnvApplyAutopilotTask } from './ai-cli-env-apply.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-12' };

const buildStatus = (
  overrides: Partial<SnapshotStatus> = {},
): SnapshotStatus => ({
  available: true,
  headSha: 'snapshot-sha',
  appliedSha: 'previous-sha',
  summary: {
    sourceHome: '/other-machine/home',
    sourceHost: `other-${hostname()}`,
    generatedAt: '2026-08-12T01:00:00.000Z',
    claude: { plugins: 2, mcpServers: 3, assets: 4 },
    codex: { plugins: 5, mcpServers: 6, assets: 7 },
  },
  ...overrides,
});

const buildPort = (status: SnapshotStatus): AiCliEnvPort => ({
  isEnabled: jest.fn().mockReturnValue(true),
  ensureRepository: jest.fn().mockResolvedValue(undefined),
  exportSnapshot: jest.fn(),
  readStatus: jest.fn().mockResolvedValue(status),
  applySnapshot: jest.fn(async (expectedSha: string) => {
    void expectedSha;
    return { appliedSha: 'snapshot-sha', output: '', warnings: [] };
  }),
});

describe('AiCliEnvApplyAutopilotTask', () => {
  it('동기화 repo 미설정이면 skip 한다', async () => {
    const port = buildPort(buildStatus());
    port.isEnabled = jest.fn().mockReturnValue(false);
    const task = new AiCliEnvApplyAutopilotTask(port);

    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(port.ensureRepository).not.toHaveBeenCalled();
  });

  it('받을 스냅샷이 없으면 skip 한다', async () => {
    const task = new AiCliEnvApplyAutopilotTask(
      buildPort(buildStatus({ available: false })),
    );

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  it('이 hostname에서 만든 스냅샷이면 skip 한다', async () => {
    const task = new AiCliEnvApplyAutopilotTask(
      buildPort(
        buildStatus({
          summary: { ...buildStatus().summary!, sourceHost: hostname() },
        }),
      ),
    );

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  it('sourceHome이 같아도 sourceHost가 다르면 복원 preview를 만든다', async () => {
    const task = new AiCliEnvApplyAutopilotTask(
      buildPort(
        buildStatus({
          summary: {
            ...buildStatus().summary!,
            sourceHome: homedir(),
            sourceHost: `other-${hostname()}`,
          },
        }),
      ),
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.preview?.previewText).toContain(`other-${hostname()}`);
  });

  it('sourceHost가 없는 구 manifest는 카드와 만든 PC 특정 불가 문구를 만든다', async () => {
    const status = buildStatus();
    const summary = { ...status.summary };
    delete summary.sourceHost;
    const task = new AiCliEnvApplyAutopilotTask(
      buildPort(buildStatus({ summary: summary as SnapshotStatus['summary'] })),
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.preview?.previewText).toContain('만든 PC를 특정할 수 없다');
  });

  it('이미 적용한 SHA면 skip 한다', async () => {
    const task = new AiCliEnvApplyAutopilotTask(
      buildPort(buildStatus({ appliedSha: 'snapshot-sha' })),
    );

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  it('다른 PC의 새 스냅샷이면 복원 내용과 주의사항을 담은 preview를 만든다', async () => {
    const task = new AiCliEnvApplyAutopilotTask(buildPort(buildStatus()));

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.preview).toMatchObject({
      kind: PREVIEW_KIND.AI_CLI_ENV_APPLY,
      payload: { snapshotSha: 'snapshot-sha', slackUserId: 'U1' },
    });
    expect(result.preview?.previewText).toContain('/other-machine/home');
    expect(result.preview?.previewText).toContain('2026-08-12T01:00:00.000Z');
    expect(result.preview?.previewText).toContain(
      'Claude: 플러그인 2·MCP 3·자산 4',
    );
    expect(result.preview?.previewText).toContain(
      'Codex: 플러그인 5·MCP 6·자산 7',
    );
    expect(result.preview?.previewText).toContain('.bak-');
    expect(result.preview?.previewText).toContain('hooks는 적용되지 않습니다');
  });
});
