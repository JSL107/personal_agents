import { PreferenceLearningAutopilotTask } from './preference-learning.autopilot-task';

const buildConfig = (enabled: string | undefined) =>
  ({ get: jest.fn().mockReturnValue(enabled) }) as never;

const ctx = { ownerSlackUserId: 'U1', firedAtKst: '2026-07-05' };

describe('PreferenceLearningAutopilotTask', () => {
  it('게이트 OFF 면 skip', async () => {
    const task = new PreferenceLearningAutopilotTask(
      { collect: jest.fn() } as never,
      { infer: jest.fn() } as never,
      { findActive: jest.fn() } as never,
      { createPending: jest.fn(), countPendingSince: jest.fn() } as never,
      buildConfig('false'),
    );
    expect(await task.run(ctx)).toEqual({ skip: true });
  });

  it('이번 주 PENDING 제안 있으면 skip', async () => {
    const task = new PreferenceLearningAutopilotTask(
      { collect: jest.fn() } as never,
      { infer: jest.fn() } as never,
      { findActive: jest.fn() } as never,
      {
        createPending: jest.fn(),
        countPendingSince: jest.fn().mockResolvedValue(1),
      } as never,
      buildConfig('true'),
    );
    expect(await task.run(ctx)).toEqual({ skip: true });
  });

  it('신호 0 → infer 미호출, skip', async () => {
    const collect = jest.fn().mockResolvedValue([]);
    const infer = jest.fn();
    const task = new PreferenceLearningAutopilotTask(
      { collect } as never,
      { infer } as never,
      { findActive: jest.fn().mockResolvedValue(null) } as never,
      { createPending: jest.fn(), countPendingSince: jest.fn().mockResolvedValue(0) } as never,
      buildConfig('true'),
    );
    expect(await task.run(ctx)).toEqual({ skip: true });
    expect(infer).not.toHaveBeenCalled();
  });

  it('diff 있으면 PENDING 생성 + preview 반환', async () => {
    const task = new PreferenceLearningAutopilotTask(
      { collect: jest.fn().mockResolvedValue([{ source: 'reaction', evidenceRef: 'r', observedText: 't' }]) } as never,
      { infer: jest.fn().mockResolvedValue({ diff: { tone: { add: ['간결'] } }, rationale: 'r' }) } as never,
      { findActive: jest.fn().mockResolvedValue({ version: 2, profile: {} }) } as never,
      { createPending: jest.fn().mockResolvedValue(11), countPendingSince: jest.fn().mockResolvedValue(0) } as never,
      buildConfig('true'),
    );
    const result = await task.run(ctx);
    expect(result.skip).toBe(false);
    expect(result.preview?.kind).toBe('PREFERENCE_PROFILE');
    expect(result.preview?.previewText).toContain('간결');
    expect((result.preview?.payload as { proposalId: number }).proposalId).toBe(11);
  });

  it('infer 결과가 null 이면 skip', async () => {
    const task = new PreferenceLearningAutopilotTask(
      { collect: jest.fn().mockResolvedValue([{ source: 'reaction', evidenceRef: 'r', observedText: 't' }]) } as never,
      { infer: jest.fn().mockResolvedValue(null) } as never,
      { findActive: jest.fn().mockResolvedValue(null) } as never,
      { createPending: jest.fn(), countPendingSince: jest.fn().mockResolvedValue(0) } as never,
      buildConfig('true'),
    );
    expect(await task.run(ctx)).toEqual({ skip: true });
  });

  it('빈 diff 면 skip', async () => {
    const task = new PreferenceLearningAutopilotTask(
      { collect: jest.fn().mockResolvedValue([{ source: 'reaction', evidenceRef: 'r', observedText: 't' }]) } as never,
      { infer: jest.fn().mockResolvedValue({ diff: {}, rationale: '변경 없음' }) } as never,
      { findActive: jest.fn().mockResolvedValue(null) } as never,
      { createPending: jest.fn(), countPendingSince: jest.fn().mockResolvedValue(0) } as never,
      buildConfig('true'),
    );
    expect(await task.run(ctx)).toEqual({ skip: true });
  });
});
