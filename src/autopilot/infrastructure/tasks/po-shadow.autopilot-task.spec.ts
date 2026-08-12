import { GeneratePoShadowUsecase } from '../../../agent/po-shadow/application/generate-po-shadow.usecase';
import { PoShadowException } from '../../../agent/po-shadow/domain/po-shadow.exception';
import { PoShadowErrorCode } from '../../../agent/po-shadow/domain/po-shadow-error-code.enum';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { PoShadowAutopilotTask } from './po-shadow.autopilot-task';

const CONTEXT = {
  ownerSlackUserId: 'U123',
  firedAtKst: '2026-07-31',
};

describe('PoShadowAutopilotTask', () => {
  let usecase: jest.Mocked<Pick<GeneratePoShadowUsecase, 'execute'>>;
  let task: PoShadowAutopilotTask;

  beforeEach(() => {
    usecase = { execute: jest.fn() };
    task = new PoShadowAutopilotTask(
      usecase as unknown as GeneratePoShadowUsecase,
    );
  });

  it('id는 po-shadow이다', () => {
    expect(task.id).toBe('po-shadow');
  });

  it('검토 결과가 있으면 cron trigger와 빈 추가 맥락으로 실행하고 summaryText를 반환한다', async () => {
    usecase.execute.mockResolvedValue({
      result: {
        priorityRecheck: '오후 우선순위 적절',
        missingRequirements: ['rollback 확인'],
        releaseRisks: ['배포 지연'],
        realPurposeQuestion: '사용자 가치가 명확한가?',
        recommendation: '오후 계획대로 진행',
      },
      modelUsed: 'codex-cli',
      agentRunId: 3,
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('오후 우선순위 적절');
    expect(usecase.execute).toHaveBeenCalledWith({
      slackUserId: 'U123',
      extraContext: '',
      triggerType: TriggerType.AUTOPILOT_PO_SHADOW_CRON,
      enforcePlanFreshness: true,
    });
  });

  // 계획이 없어 검토를 못 한 회차는 `skip: true` 로 끊으면 Slack·원장 어디에도 남지 않아,
  // 연쇄로 멈춘 자리가 침묵한다. 하트비트 한 줄로 "계획이 없었다" 를 드러낸다.
  it('NO_RECENT_PLAN이면 계획 부재 하트비트를 남긴다 (조용히 사라지지 않는다)', async () => {
    usecase.execute.mockRejectedValue(
      new PoShadowException({
        code: PoShadowErrorCode.NO_RECENT_PLAN,
        message: '검토할 plan 없음',
        status: DomainStatus.PRECONDITION_FAILED,
      }),
    );

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('2026-07-31');
    expect(result.summaryText).toContain('최근 계획 없음');
  });

  it('STALE_PLAN이면 오래된 계획임을 밝히는 하트비트를 남긴다', async () => {
    usecase.execute.mockRejectedValue(
      new PoShadowException({
        code: PoShadowErrorCode.STALE_PLAN,
        message: '검토할 PM plan이 오래됨',
        status: DomainStatus.PRECONDITION_FAILED,
      }),
    );

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('계획이 오래돼');
    // 두 사유가 같은 문구로 뭉개지면 다이제스트에서 원인을 가릴 수 없다.
    expect(result.summaryText).not.toContain('최근 계획 없음');
  });

  it('skip 대상이 아닌 PoShadowException은 다시 던진다', async () => {
    const error = new PoShadowException({
      code: PoShadowErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 출력 오류',
      status: DomainStatus.INTERNAL,
    });
    usecase.execute.mockRejectedValue(error);

    await expect(task.run(CONTEXT)).rejects.toBe(error);
  });
});
