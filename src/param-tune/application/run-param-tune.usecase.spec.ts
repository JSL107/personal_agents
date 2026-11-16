import { ConfigService } from '@nestjs/config';

import { ReplayBacktestUsecase } from '../../backtest/application/replay-backtest.usecase';
import {
  replayParameters,
  runRobustSearch,
} from '../../backtest/application/robust-parameter-search';
import {
  evaluateRobustWalkForward,
  ParameterCombination,
  RobustWalkForwardVerdict,
} from '../../backtest/domain/parameter-search';
import { StrategyParameterPort } from '../../strategy-parameter/domain/port/strategy-parameter.port';
import { StrategyParameterSnapshotError } from '../../strategy-parameter/domain/strategy-parameter.exception';
import { ParameterSnapshot } from '../domain/param-tune.type';
import {
  OpenProbation,
  ParamTuneRunPort,
} from '../domain/port/param-tune-run.port';
import {
  combinationFromSnapshot,
  withAxisValue,
} from '../domain/tune-combination';
import { lastCompletedWindowEnd } from '../domain/tune-schedule';
import { EvaluateProbationService } from './evaluate-probation.service';
import { RunParamTuneUsecase } from './run-param-tune.usecase';

jest.mock('../../backtest/application/robust-parameter-search', () => ({
  ...jest.requireActual('../../backtest/application/robust-parameter-search'),
  replayParameters: jest.fn(),
  runRobustSearch: jest.fn(),
}));
jest.mock('../../backtest/domain/parameter-search', () => ({
  ...jest.requireActual('../../backtest/domain/parameter-search'),
  evaluateRobustWalkForward: jest.fn(),
}));

const TODAY = '2026-11-16';
const snapshot: ParameterSnapshot = [
  { name: 'EXIT_TAKE_PROFIT_PERCENT', parameterId: 11, version: 1, value: 10 },
  { name: 'EXIT_STOP_LOSS_PERCENT', parameterId: 12, version: 1, value: -5 },
  {
    name: 'MINIMUM_TURNOVER60',
    parameterId: 13,
    version: 1,
    value: 500_000_000,
  },
  { name: 'MAXIMUM_WEIGHT_PERCENT', parameterId: 14, version: 1, value: 20 },
];
const input = {
  runId: 7,
  attemptToken: 'token',
  strategy: 'SWING' as const,
  axis: 'EXIT_TAKE_PROFIT_PERCENT' as const,
  today: TODAY,
  agentRunId: 99,
};

const probation: OpenProbation = {
  runId: 3,
  axis: 'EXIT_TAKE_PROFIT_PERCENT',
  previousValue: 5,
  candidateValue: 10,
  previousParameterId: 1,
  appliedParameterId: 11,
  startedOn: new Date('2026-09-01T00:00:00Z'),
};

const replayResult = (excessRate: string | null, tradeDates = 30) => ({
  meanExcessReturnRate: excessRate,
  tradeDateCount: tradeDates,
  scores: [{ strategy: 'SWING', closedCount: 10 }],
  invariantViolations: [] as string[],
});

const verdictOf = (label: string): RobustWalkForwardVerdict => ({
  windowIndex: 0,
  trainedWindowCount: 2,
  chosenLabel: label,
  byCondition: [
    {
      conditionLabel: 'c',
      chosenExcessReturnPercent: 3,
      baselineExcessReturnPercent: 1,
      won: true,
    },
  ],
  wonEveryCondition: true,
});

describe('RunParamTuneUsecase', () => {
  const runPort = {
    finish: jest.fn(),
    markFailed: jest.fn(),
    findOpenProbation: jest.fn(),
    findWouldApplyUnevaluated: jest.fn(),
    settleEvaluation: jest.fn(),
    findExcludedValues: jest.fn(),
    findVerdictByKey: jest.fn(),
  };
  const parameterPort = {
    findSnapshotStrict: jest.fn(),
    activateNewVersion: jest.fn(),
  };
  const config = { get: jest.fn() };
  const replay = {} as ReplayBacktestUsecase;
  const mockedReplayParameters = replayParameters as jest.Mock;
  const mockedRunRobustSearch = runRobustSearch as jest.Mock;
  const mockedEvaluate = evaluateRobustWalkForward as jest.Mock;

  const usecase = new RunParamTuneUsecase(
    runPort as unknown as ParamTuneRunPort,
    parameterPort as unknown as StrategyParameterPort,
    new EvaluateProbationService(
      runPort as unknown as ParamTuneRunPort,
      parameterPort as unknown as StrategyParameterPort,
      replay,
    ),
    replay,
    config as unknown as ConfigService,
  );

  const current = combinationFromSnapshot(snapshot);
  const candidate15 = withAxisValue(current, 'EXIT_TAKE_PROFIT_PERCENT', 15);

  const searchReturns = (
    combinations: Map<string, ParameterCombination>,
  ): void => {
    mockedRunRobustSearch.mockResolvedValue(
      new Map([
        [
          'SWING',
          {
            conditions: [],
            baselineLabel: 'BASE',
            combinationByLabel: combinations,
            windowSummaries: new Map(),
          },
        ],
      ]),
    );
  };
  const adoptableVerdicts = (): RobustWalkForwardVerdict[] =>
    Array.from({ length: 6 }, () => verdictOf('L15'));
  const adoptableSearch = (): void => {
    searchReturns(
      new Map([
        ['BASE', current],
        ['L15', candidate15],
      ]),
    );
    mockedEvaluate.mockReturnValue(adoptableVerdicts());
  };

  // 롤백으로 판정되는 재생: 새 값이 이전 값보다 모든 슬리피지에서 -1%p.
  const rollbackReplays = (): void => {
    mockedReplayParameters.mockImplementation(
      async (args: { combination: ParameterCombination }) =>
        replayResult(args.combination.takeProfitPercent === 10 ? '-0.01' : '0'),
    );
  };
  const keepReplays = (): void => {
    mockedReplayParameters.mockImplementation(
      async (args: { combination: ParameterCombination }) =>
        replayResult(args.combination.takeProfitPercent === 10 ? '0.01' : '0'),
    );
  };

  const finishedPatch = () => runPort.finish.mock.calls[0][0].patch;

  beforeEach(() => {
    jest.resetAllMocks();
    config.get.mockReturnValue('observe');
    parameterPort.findSnapshotStrict.mockResolvedValue(snapshot);
    runPort.findOpenProbation.mockResolvedValue(null);
    runPort.findWouldApplyUnevaluated.mockResolvedValue([]);
    runPort.findExcludedValues.mockResolvedValue([]);
    runPort.findVerdictByKey.mockResolvedValue(null);
    runPort.settleEvaluation.mockResolvedValue(true);
    runPort.finish.mockResolvedValue(true);
    runPort.markFailed.mockResolvedValue(true);
    parameterPort.activateNewVersion.mockResolvedValue({
      kind: 'ACTIVATED',
      parameterId: 21,
      version: 2,
    });
  });

  it('엄격 읽기 실패면 markFailed 만 부르고 탐색하지 않는다', async () => {
    parameterPort.findSnapshotStrict.mockRejectedValue(
      new StrategyParameterSnapshotError('MINIMUM_TURNOVER60 없음'),
    );

    await usecase.execute(input);

    expect(runPort.markFailed).toHaveBeenCalledTimes(1);
    expect(runPort.markFailed).toHaveBeenCalledWith({
      runId: 7,
      attemptToken: 'token',
      reason: '활성 행 없음: MINIMUM_TURNOVER60 없음',
    });
    expect(runPort.finish).not.toHaveBeenCalled();
    expect(mockedRunRobustSearch).not.toHaveBeenCalled();
  });

  it('예상 못 한 오류는 메시지 첫 줄로 markFailed 하고 다시 던지지 않는다', async () => {
    runPort.findExcludedValues.mockRejectedValue(new Error('DB 끊김\n스택'));

    await expect(usecase.execute(input)).resolves.toBeUndefined();

    expect(runPort.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'DB 끊김' }),
    );
    expect(runPort.finish).not.toHaveBeenCalled();
  });

  it('observe 에서도 열린 시험이 롤백 판정이면 이전 값으로 되돌리고 탐색하지 않는다', async () => {
    runPort.findOpenProbation.mockResolvedValue(probation);
    rollbackReplays();

    await usecase.execute(input);

    expect(parameterPort.activateNewVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'EXIT_TAKE_PROFIT_PERCENT',
        value: 5,
        expectedSnapshot: snapshot,
        reason: '자동 조정 롤백 (run #7)',
        agentRunId: 99,
      }),
    );
    expect(runPort.settleEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 3, evaluation: 'ROLLBACK' }),
    );
    // R3: 값이 방금 바뀐 주에는 탐색하지 않는다.
    expect(mockedRunRobustSearch).not.toHaveBeenCalled();
    expect(finishedPatch()).toEqual({
      status: 'DONE',
      decisionReason: '롤백한 주라 탐색하지 않음',
    });
  });

  it('대상 축의 parameterId 가 바뀌었으면 ROLLBACK_SKIPPED 로 확정하고 값을 바꾸지 않는다', async () => {
    runPort.findOpenProbation.mockResolvedValue({
      ...probation,
      appliedParameterId: 999,
    });
    rollbackReplays();
    mockedEvaluate.mockReturnValue([]);
    searchReturns(new Map([['BASE', current]]));

    await usecase.execute(input);

    expect(runPort.settleEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ evaluation: 'ROLLBACK_SKIPPED' }),
    );
    expect(parameterPort.activateNewVersion).not.toHaveBeenCalled();
  });

  it('KEEP 판정이면 KEEP 으로 확정하고 이어서 탐색한다', async () => {
    runPort.findOpenProbation.mockResolvedValue(probation);
    keepReplays();
    adoptableSearch();

    await usecase.execute(input);

    expect(runPort.settleEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ evaluation: 'KEEP' }),
    );
    expect(mockedRunRobustSearch).toHaveBeenCalledTimes(1);
  });

  it('표본이 모자라 WAIT 이면 확정하지 않고 SKIPPED_PROBATION 으로 끝낸다', async () => {
    runPort.findOpenProbation.mockResolvedValue(probation);
    mockedReplayParameters.mockResolvedValue(replayResult('0.01', 3));

    await usecase.execute(input);

    expect(runPort.settleEvaluation).not.toHaveBeenCalled();
    expect(mockedRunRobustSearch).not.toHaveBeenCalled();
    expect(finishedPatch()).toEqual({ status: 'SKIPPED_PROBATION' });
  });

  it('가상 시험은 WOULD_ROLLBACK 으로만 기록하고 값을 바꾸지 않으며 탐색을 막지 않는다', async () => {
    runPort.findWouldApplyUnevaluated.mockResolvedValue([probation]);
    rollbackReplays();
    adoptableSearch();

    await usecase.execute(input);

    expect(runPort.settleEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 3, evaluation: 'WOULD_ROLLBACK' }),
    );
    expect(parameterPort.activateNewVersion).not.toHaveBeenCalled();
    expect(mockedRunRobustSearch).toHaveBeenCalledTimes(1);
  });

  it('같은 verdictKey 캐시가 있으면 탐색 없이 저장된 판정으로 조합을 되살린다', async () => {
    runPort.findVerdictByKey.mockResolvedValue({
      runId: 1,
      verdict: {
        verdicts: adoptableVerdicts(),
        combinations: [
          { label: 'BASE', combination: current },
          { label: 'L15', combination: candidate15 },
        ],
        chosenLabel: 'L15',
      },
    });

    await usecase.execute(input);

    expect(mockedRunRobustSearch).not.toHaveBeenCalled();
    expect(runPort.findVerdictByKey).toHaveBeenCalledWith(
      [
        'EXIT_TAKE_PROFIT_PERCENT',
        lastCompletedWindowEnd(TODAY),
        1,
        1,
        1,
        1,
      ].join('|'),
    );
    expect(finishedPatch()).toMatchObject({
      status: 'DONE',
      decision: 'WOULD_APPLY',
      candidateValue: 15,
    });
  });

  it('excluded 값은 탐색 격자에서 빠지고 verdictKey 에 정렬되어 들어간다', async () => {
    runPort.findExcludedValues.mockResolvedValue([-7, -3]);
    mockedEvaluate.mockReturnValue([]);
    searchReturns(new Map([['BASE', current]]));

    await usecase.execute({ ...input, axis: 'EXIT_STOP_LOSS_PERCENT' });

    const searchInput = mockedRunRobustSearch.mock.calls[0][0];
    const stopLosses = searchInput.strategies[0].combinations.map(
      (combination: ParameterCombination) => combination.stopLossPercent,
    );
    expect(stopLosses).not.toContain(-7);
    expect(stopLosses).not.toContain(-3);
    expect(stopLosses).toContain(-5); // 현행값은 기준선으로 남는다
    expect(runPort.findVerdictByKey.mock.calls[0][0]).toMatch(/\|-7\|-3$/);
  });

  it('apply + ADOPT + 충돌이면 NO_CHANGE 와 사유를 남긴다', async () => {
    config.get.mockReturnValue('apply');
    adoptableSearch();
    parameterPort.activateNewVersion.mockResolvedValue({
      kind: 'CONFLICT',
      actual: snapshot,
    });

    await usecase.execute(input);

    expect(finishedPatch()).toMatchObject({
      decision: 'NO_CHANGE',
      decisionReason: '활성값 변경 감지',
    });
  });

  it('apply + ADOPT 이면 값을 반영하고 APPLIED 와 id 들을 기록한다', async () => {
    config.get.mockReturnValue('apply');
    adoptableSearch();

    await usecase.execute(input);

    expect(parameterPort.activateNewVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 15,
        expectedSnapshot: snapshot,
        agentRunId: 99,
      }),
    );
    expect(finishedPatch()).toMatchObject({
      status: 'DONE',
      decision: 'APPLIED',
      previousValue: 10,
      candidateValue: 15,
      previousParameterId: 11,
      appliedParameterId: 21,
      parameterSnapshot: snapshot,
    });
    expect(finishedPatch().appliedAt).toBeInstanceOf(Date);
  });

  it('observe + ADOPT 이면 WOULD_APPLY 이고 값을 바꾸지 않는다', async () => {
    adoptableSearch();

    await usecase.execute(input);

    expect(parameterPort.activateNewVersion).not.toHaveBeenCalled();
    expect(finishedPatch()).toMatchObject({
      decision: 'WOULD_APPLY',
      previousValue: 10,
      candidateValue: 15,
    });
  });

  it('한 칸 제한 결과가 제외 값이면 반영하지 않는다', async () => {
    config.get.mockReturnValue('apply');
    const stopLoss = (value: number) =>
      withAxisValue(current, 'EXIT_STOP_LOSS_PERCENT', value);
    runPort.findExcludedValues.mockResolvedValue([-7]);
    searchReturns(
      new Map([
        ['BASE', current],
        ['L10', stopLoss(-10)],
      ]),
    );
    mockedEvaluate.mockReturnValue(
      Array.from({ length: 6 }, () => verdictOf('L10')),
    );

    await usecase.execute({ ...input, axis: 'EXIT_STOP_LOSS_PERCENT' });

    expect(parameterPort.activateNewVersion).not.toHaveBeenCalled();
    expect(finishedPatch()).toMatchObject({
      decision: 'NO_CHANGE',
      decisionReason: '제외된 값(-7)으로 한 칸 제한됨',
    });
  });

  it('같은 값의 가상 시험이 열려 있으면 WOULD_APPLY 를 또 만들지 않는다', async () => {
    adoptableSearch();
    runPort.findWouldApplyUnevaluated.mockResolvedValue([
      { ...probation, runId: 5, candidateValue: 15 },
    ]);
    // 이 가상 시험은 표본 부족(WAIT)이라 그대로 열려 있다.
    mockedReplayParameters.mockResolvedValue(replayResult('0.01', 3));

    await usecase.execute(input);

    expect(finishedPatch()).toMatchObject({
      decision: 'NO_CHANGE',
      decisionReason: '같은 값 가상 시험 중 (run #5)',
    });
  });

  it('판정이 NO_CHANGE 면 그 사유를 기록한다', async () => {
    searchReturns(new Map([['BASE', current]]));
    mockedEvaluate.mockReturnValue([]);

    await usecase.execute(input);

    expect(finishedPatch()).toMatchObject({
      decision: 'NO_CHANGE',
      decisionReason: '판정 가능 창 부족',
    });
  });

  it('off 이고 열린 시험이 없으면 탐색하지 않고 DONE 으로 끝낸다', async () => {
    config.get.mockReturnValue('off');

    await usecase.execute(input);

    expect(mockedRunRobustSearch).not.toHaveBeenCalled();
    expect(runPort.findVerdictByKey).not.toHaveBeenCalled();
    expect(finishedPatch()).toEqual({ status: 'DONE', decisionReason: 'off' });
  });

  it('finish 가 토큰 불일치로 false 여도 던지지 않는다', async () => {
    config.get.mockReturnValue('off');
    runPort.finish.mockResolvedValue(false);

    await expect(usecase.execute(input)).resolves.toBeUndefined();
    expect(runPort.markFailed).not.toHaveBeenCalled();
  });
});
