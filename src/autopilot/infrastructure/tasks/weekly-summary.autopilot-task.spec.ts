import { CeoException } from '../../../agent/ceo/domain/ceo.exception';
import { CeoErrorCode } from '../../../agent/ceo/domain/ceo-error-code.enum';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { WeeklySummaryAutopilotTask } from './weekly-summary.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };

describe('WeeklySummaryAutopilotTask', () => {
  it('id 는 weekly-summary', () => {
    expect(
      new WeeklySummaryAutopilotTask({} as never, {} as never, {} as never).id,
    ).toBe('weekly-summary');
  });

  it('이번 주 PM run 0건 → graceful skip 안내(skip=false, worklog/CEO 미호출)', async () => {
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([]);
    const worklogExecute = jest.fn();
    const ceoExecute = jest.fn();
    const task = new WeeklySummaryAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute: worklogExecute } as never,
      { execute: ceoExecute } as never,
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('skip');
    expect(worklogExecute).not.toHaveBeenCalled();
    expect(ceoExecute).not.toHaveBeenCalled();
    expect(findRecentSucceededRuns).toHaveBeenCalledWith(
      expect.objectContaining({ sinceDays: 7 }),
    );
  });

  it('worklog 성공 시 요약은 summaryText, 근거 detail 은 detailText 스레드로 분리 (CEO skip 시 CEO detail 없음)', async () => {
    const findRecentSucceededRuns = jest
      .fn()
      .mockResolvedValue([
        { output: 'not-a-plan', endedAt: new Date('2026-06-17T09:00:00Z') },
      ]);
    const worklogExecute = jest.fn().mockResolvedValue({
      result: {
        summary: '이번주 요약',
        oneLineAchievement: '핵심 성과',
        impact: { quantitative: ['PR 3건'], qualitative: '질적 영향 텍스트' },
        improvementBeforeAfter: null,
        nextActions: ['다음주 액션'],
      },
      modelUsed: 'codex-cli',
      agentRunId: 42,
    });
    const ceoExecute = jest.fn().mockRejectedValue(
      new CeoException({
        code: CeoErrorCode.NO_PO_EVAL_RUN,
        message: '없음',
        status: DomainStatus.NOT_FOUND,
      }),
    );
    const task = new WeeklySummaryAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute: worklogExecute } as never,
      { execute: ceoExecute } as never,
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    // 메인(summaryText): worklog 헤더 + 요약, CEO skip 안내. 근거 섹션은 없다.
    expect(out.summaryText).toContain('Weekly Summary');
    expect(out.summaryText).toContain('이번주 요약');
    expect(out.summaryText).toContain('CEO Meta');
    expect(out.summaryText).not.toContain('정량 근거');
    expect(out.summaryText).not.toContain('질적 영향');
    // 스레드(detailText): worklog detail(정량 근거·질적 영향·다음 액션) + model 푸터. CEO skip 이라 CEO detail 없음.
    expect(out.detailText).toContain('정량 근거');
    expect(out.detailText).toContain('질적 영향');
    expect(out.detailText).toContain('다음 액션');
    expect(out.detailText).toContain('run #42');
  });
});
