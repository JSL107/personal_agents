import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { AiCliEnvPort } from '../domain/port/ai-cli-env.port';
import { AiCliEnvApplyPreviewApplier } from './ai-cli-env-apply.preview-applier';

const preview = {
  id: 'preview-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.AI_CLI_ENV_APPLY,
  payload: { snapshotSha: 'snapshot-sha', slackUserId: 'U1' },
} as PreviewAction;

describe('AiCliEnvApplyPreviewApplier', () => {
  it('payload SHA를 적용하고 경고 건수와 목록을 사용자 요약으로 반환한다', async () => {
    const port = {
      isEnabled: jest.fn(),
      ensureRepository: jest.fn(),
      exportSnapshot: jest.fn(),
      readStatus: jest.fn(),
      applySnapshot: jest.fn().mockResolvedValue({
        appliedSha: 'snapshot-sha',
        output: 'applied Claude and Codex settings',
        warnings: ['claude CLI 없음', 'MCP github 토큰 없음'],
      }),
    } satisfies AiCliEnvPort;
    const applier = new AiCliEnvApplyPreviewApplier(port);

    const result = await applier.apply(preview);

    expect(port.applySnapshot).toHaveBeenCalledWith('snapshot-sha');
    expect(result.message).toContain('snapshot-sha');
    expect(result.message).toContain('주의 2건');
    expect(result.message).toContain('- claude CLI 없음');
    expect(result.message).toContain('- MCP github 토큰 없음');
    expect(result.artifacts).toEqual([]);
  });

  it('경고가 없으면 사용자 요약에 warning 블록을 넣지 않는다', async () => {
    const port = {
      isEnabled: jest.fn(),
      ensureRepository: jest.fn(),
      exportSnapshot: jest.fn(),
      readStatus: jest.fn(),
      applySnapshot: jest.fn().mockResolvedValue({
        appliedSha: 'snapshot-sha',
        output: 'applied Claude and Codex settings',
        warnings: [],
      }),
    } satisfies AiCliEnvPort;
    const applier = new AiCliEnvApplyPreviewApplier(port);

    const result = await applier.apply(preview);

    expect(result.message).not.toContain('주의');
    expect(result.message).not.toContain('경고');
  });

  it('bootstrap 실패는 성공으로 위장하지 않고 전파한다', async () => {
    const error = new Error('bootstrap failed');
    const port = {
      isEnabled: jest.fn(),
      ensureRepository: jest.fn(),
      exportSnapshot: jest.fn(),
      readStatus: jest.fn(),
      applySnapshot: jest.fn().mockRejectedValue(error),
    } satisfies AiCliEnvPort;
    const applier = new AiCliEnvApplyPreviewApplier(port);

    await expect(applier.apply(preview)).rejects.toBe(error);
  });
});
