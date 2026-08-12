import { GenerateAssignmentUsecase } from '../../../agent/cto/application/generate-assignment.usecase';
import { CtoException } from '../../../agent/cto/domain/cto.exception';
import { CtoErrorCode } from '../../../agent/cto/domain/cto-error-code.enum';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { AssignAutopilotTask } from './assign.autopilot-task';

const CONTEXT = {
  ownerSlackUserId: 'U123',
  firedAtKst: '2026-07-31',
};

describe('AssignAutopilotTask', () => {
  let usecase: jest.Mocked<Pick<GenerateAssignmentUsecase, 'execute'>>;
  let humanizeService: jest.Mocked<Pick<HumanizeService, 'humanize'>>;
  let task: AssignAutopilotTask;

  beforeEach(() => {
    usecase = { execute: jest.fn() };
    // 입력을 그대로 돌려주는 통과 mock — 실제 HumanizeService 의 best-effort 계약과 같다.
    humanizeService = {
      humanize: jest
        .fn()
        .mockImplementation((fields: Record<string, string>) =>
          Promise.resolve(fields),
        ),
    };
    task = new AssignAutopilotTask(
      usecase as unknown as GenerateAssignmentUsecase,
      humanizeService as unknown as HumanizeService,
    );
  });

  it('id는 assign이다', () => {
    expect(task.id).toBe('assign');
  });

  it('배정 결과가 있으면 cron trigger로 실행하고 summaryText를 반환한다', async () => {
    usecase.execute.mockResolvedValue({
      result: {
        assignments: [
          {
            taskId: 'task-1',
            taskTitle: '오후 API 구현',
            beAssignment: AgentType.BE,
            priority: 1,
            reasoning: 'API 구현 작업',
            confidence: 0.9,
          },
        ],
        unassignedTasks: [],
        ctoSummary: '1건 배정',
      },
      modelUsed: 'codex-cli',
      agentRunId: 1,
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('오후 API 구현');
    expect(usecase.execute).toHaveBeenCalledWith({
      slackUserId: 'U123',
      triggerType: TriggerType.AUTOPILOT_ASSIGN_CRON,
    });
  });

  it('NO_RECENT_PM_RUN이면 정상 미실행으로 skip한다', async () => {
    usecase.execute.mockRejectedValue(
      new CtoException({
        code: CtoErrorCode.NO_RECENT_PM_RUN,
        message: '검토할 최근 PM run 없음',
        status: DomainStatus.NOT_FOUND,
      }),
    );

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('STALE_PM_RUN이면 정상 미실행으로 skip한다', async () => {
    usecase.execute.mockRejectedValue(
      new CtoException({
        code: CtoErrorCode.STALE_PM_RUN,
        message: '검토할 PM run이 오래됨',
        status: DomainStatus.NOT_FOUND,
      }),
    );

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('NO_ASSIGNABLE_TASKS이면 정상 미실행으로 skip한다', async () => {
    usecase.execute.mockRejectedValue(
      new CtoException({
        code: CtoErrorCode.NO_ASSIGNABLE_TASKS,
        message: '오늘 배정할 task 없음',
        status: DomainStatus.NOT_FOUND,
      }),
    );

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('배정과 미배정 결과가 모두 비면 skip한다', async () => {
    usecase.execute.mockResolvedValue({
      result: {
        assignments: [],
        unassignedTasks: [],
        ctoSummary: '배정 대상 없음',
      },
      modelUsed: 'codex-cli',
      agentRunId: 2,
    });

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('자동 발송 텍스트도 슬래시와 똑같이 윤문을 거친다', async () => {
    usecase.execute.mockResolvedValue({
      result: {
        assignments: [],
        unassignedTasks: [
          { taskId: 'task-9', taskTitle: '보류 작업', reason: '원문 사유' },
        ],
        ctoSummary: '원문 요약',
      },
      modelUsed: 'codex-cli',
      agentRunId: 3,
    });
    humanizeService.humanize.mockResolvedValue({
      ctoSummary: '윤문된 요약',
      'unassignedTasks.reason.0': '윤문된 사유',
    });

    const result = await task.run(CONTEXT);

    expect(humanizeService.humanize).toHaveBeenCalled();
    expect(result.summaryText).toContain('윤문된 요약');
    expect(result.summaryText).not.toContain('원문 요약');
  });

  it('정상 미실행 코드가 아닌 CtoException은 다시 던진다', async () => {
    const error = new CtoException({
      code: CtoErrorCode.PARSE_FAILED,
      message: '모델 출력 파싱 오류',
      status: DomainStatus.INTERNAL,
    });
    usecase.execute.mockRejectedValue(error);

    await expect(task.run(CONTEXT)).rejects.toBe(error);
  });
});
