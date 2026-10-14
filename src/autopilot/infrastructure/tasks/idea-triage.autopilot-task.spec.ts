import { TriageIdeaChannelUsecase } from '../../../idea-triage/application/triage-idea-channel.usecase';
import { IdeaTriageAutopilotTask } from './idea-triage.autopilot-task';

describe('IdeaTriageAutopilotTask', () => {
  const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-10-14' };

  it('채널 미설정 회차는 발송 원장용 빈 이유 없이 건너뛴다', async () => {
    const execute = jest.fn().mockResolvedValue({
      skipped: 'NOT_CONFIGURED',
      judged: 0,
      posted: 0,
      failed: 0,
      byVerdict: { BUILD: 0, REVISE_THEN_BUILD: 0, DROP: 0 },
    });
    const task = new IdeaTriageAutopilotTask({
      execute,
    } as unknown as TriageIdeaChannelUsecase);

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  it('판정 결과와 실패 건수를 요약한다', async () => {
    const execute = jest.fn().mockResolvedValue({
      judged: 3,
      posted: 2,
      failed: 1,
      byVerdict: { BUILD: 1, REVISE_THEN_BUILD: 1, DROP: 1 },
    });
    const task = new IdeaTriageAutopilotTask({
      execute,
    } as unknown as TriageIdeaChannelUsecase);

    await expect(task.run(context)).resolves.toEqual({
      skip: false,
      summaryText:
        '💡 아이디어 3건 판정 — 만든다 1 · 고치고 만든다 1 · 접는다 1 (실패 1)',
    });
  });
});
