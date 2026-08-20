import { GeneratePoShadowUsecase } from '../../../agent/po-shadow/application/generate-po-shadow.usecase';
import { PoShadowException } from '../../../agent/po-shadow/domain/po-shadow.exception';
import { PoShadowReport } from '../../../agent/po-shadow/domain/po-shadow.type';
import { PoShadowErrorCode } from '../../../agent/po-shadow/domain/po-shadow-error-code.enum';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { PoShadowAutopilotTask } from './po-shadow.autopilot-task';

const CONTEXT = {
  ownerSlackUserId: 'U123',
  firedAtKst: '2026-07-31',
};

const quietReport = (): PoShadowReport => ({
  schemaVersion: 2,
  quiet: true,
  headline: '계획대로 진행 중',
  findings: [],
  purposeConflict: null,
  factSummary: ['#10 머지 완료'],
  droppedFindingCount: 0,
  degradedSources: [],
});

const nonQuietReport = (): PoShadowReport => ({
  schemaVersion: 2,
  quiet: false,
  headline: '원문 헤드라인',
  findings: [
    {
      factIds: ['stalled:acme/app#264'],
      point: '원문 지적',
      suggestion: '원문 제안',
    },
  ],
  purposeConflict: '원문 목적 충돌',
  factSummary: ['#264 원본 사실'],
  droppedFindingCount: 0,
  degradedSources: [],
});

describe('PoShadowAutopilotTask', () => {
  let usecase: jest.Mocked<Pick<GeneratePoShadowUsecase, 'execute'>>;
  let humanizeService: jest.Mocked<Pick<HumanizeService, 'humanize'>>;
  let task: PoShadowAutopilotTask;

  beforeEach(() => {
    usecase = { execute: jest.fn() };
    humanizeService = {
      humanize: jest
        .fn()
        .mockImplementation((fields: Record<string, string>) =>
          Promise.resolve(fields),
        ),
    };
    task = new PoShadowAutopilotTask(
      usecase as unknown as GeneratePoShadowUsecase,
      humanizeService as unknown as HumanizeService,
    );
  });

  it('id는 po-shadow이다', () => {
    expect(task.id).toBe('po-shadow');
  });

  it('quiet 결과는 윤문을 건너뛰고 원본 사실로 한 줄을 만든다', async () => {
    usecase.execute.mockResolvedValue({
      result: quietReport(),
      modelUsed: 'none',
      agentRunId: 3,
    });

    const result = await task.run(CONTEXT);

    expect(result).toEqual({
      skip: false,
      summaryText: '✅ *PO 검토* — 계획대로 진행 중 (#10 머지 완료)',
    });
    expect(humanizeService.humanize).not.toHaveBeenCalled();
    expect(usecase.execute).toHaveBeenCalledWith({
      slackUserId: 'U123',
      extraContext: '',
      triggerType: TriggerType.AUTOPILOT_PO_SHADOW_CRON,
      enforcePlanFreshness: true,
    });
  });

  it('non-quiet 결과는 서술 필드 윤문본을 렌더하고 원본 factSummary를 보존한다', async () => {
    usecase.execute.mockResolvedValue({
      result: nonQuietReport(),
      modelUsed: 'codex-cli',
      agentRunId: 4,
    });
    humanizeService.humanize.mockResolvedValue({
      headline: '윤문 헤드라인',
      'findings.point.0': '윤문 지적',
      'findings.suggestion.0': '윤문 제안',
      purposeConflict: '윤문 목적 충돌',
    });

    const result = await task.run(CONTEXT);

    expect(result.summaryText).toContain('🎯 *먼저 이것부터* 윤문 헤드라인');
    expect(result.summaryText).toContain('• 윤문 지적 — 윤문 제안');
    expect(result.summaryText).toContain('⚠️ *1순위와 어긋남* 윤문 목적 충돌');
    expect(result.summaryText).toContain('↳ 근거: #264 원본 사실');
    expect(result.summaryText).not.toContain('원문 헤드라인');
  });

  it('NO_RECENT_PLAN이면 계획 부재 하트비트를 남긴다', async () => {
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
