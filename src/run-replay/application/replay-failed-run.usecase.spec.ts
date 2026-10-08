import { TriggerType } from '../../agent-run/domain/agent-run.type';
import {
  REPLAYABLE_AGENT_TYPES,
  ReplayRejectionCode,
} from '../domain/run-replay.type';
import {
  ReplayFailedRunUsecase,
  ReplayPreparation,
} from './replay-failed-run.usecase';
import { ReplayInFlightLock } from './replay-in-flight.lock';

const OWNER = 'U1';

const outcome = (agentRunId: number) => ({
  agentRunId,
  modelUsed: 'codex-cli',
  result: {},
});

const setup = (payload: unknown) => {
  const retryRunUsecase = { execute: jest.fn().mockResolvedValue(payload) };
  const agentUsecase = () => ({
    execute: jest.fn().mockResolvedValue(outcome(99)),
  });
  const dependencies = {
    retryRunUsecase,
    generateDailyPlanUsecase: agentUsecase(),
    generateWorklogUsecase: agentUsecase(),
    reviewPullRequestUsecase: agentUsecase(),
    generateImpactReportUsecase: agentUsecase(),
    generatePoShadowUsecase: agentUsecase(),
    generatePoEvaluationUsecase: agentUsecase(),
    generateCeoMetaUsecase: agentUsecase(),
    generatePaperRecommendationUsecase: {
      execute: jest.fn().mockResolvedValue({
        completed: [{ agentRunId: 99, strategy: 'SWING', ordersCreated: 1 }],
        failed: [],
      }),
    },
    publishNotionDraftUsecase: agentUsecase(),
    paperTradingRepository: {
      findAccountByName: jest.fn().mockResolvedValue({ id: 5 }),
      hasOrdersForRecommendation: jest.fn().mockResolvedValue(false),
    },
    agentRunService: { setParentId: jest.fn().mockResolvedValue(undefined) },
    watchVideoUsecase: agentUsecase(),
    inFlightLock: new ReplayInFlightLock(),
  };
  const usecase = new ReplayFailedRunUsecase(
    ...(Object.values(dependencies) as unknown as ConstructorParameters<
      typeof ReplayFailedRunUsecase
    >),
  );
  const prepare = (requesterSlackUserId = OWNER) =>
    usecase.prepare({ runId: 42, requesterSlackUserId });
  return { prepare, ...dependencies };
};

const failedRun = (agentType: string, inputSnapshot: unknown = {}) => ({
  id: 42,
  agentType,
  inputSnapshot,
});

const expectRejected = (
  preparation: ReplayPreparation,
  code: ReplayRejectionCode,
) => {
  expect(preparation).toMatchObject({ kind: 'REJECTED', code });
};

describe('ReplayFailedRunUsecase', () => {
  describe('거절', () => {
    it('FAILED 가 아니거나 없는 실행은 NOT_FOUND', async () => {
      const { prepare } = setup(null);
      expectRejected(await prepare(), ReplayRejectionCode.NOT_FOUND);
    });

    it('inputSnapshot 이 객체가 아니면 INVALID_SNAPSHOT', async () => {
      const { prepare } = setup(failedRun('PM', ['배열']));
      expectRejected(await prepare(), ReplayRejectionCode.INVALID_SNAPSHOT);
    });

    it('다른 사용자의 실행은 FORBIDDEN — 아무것도 실행하지 않는다', async () => {
      const { prepare, generateDailyPlanUsecase } = setup(
        failedRun('PM', { slackUserId: 'U_OTHER' }),
      );
      expectRejected(await prepare(), ReplayRejectionCode.FORBIDDEN);
      expect(generateDailyPlanUsecase.execute).not.toHaveBeenCalled();
    });

    it.each([
      'VACATION',
      'DELAY_REPORT',
      'BLOG_REVISION',
      'BLOG',
      'CAREER_MATE',
      'JOB_APPLICATION',
    ])('%s 는 재실행 개념이 없어 NOT_SUPPORTED', async (agentType) => {
      const { prepare } = setup(failedRun(agentType));
      expectRejected(await prepare(), ReplayRejectionCode.NOT_SUPPORTED);
    });

    it('처음 보는 종류는 UNKNOWN_AGENT_TYPE', async () => {
      const { prepare } = setup(failedRun('SOMETHING_NEW'));
      const preparation = await prepare();
      expectRejected(preparation, ReplayRejectionCode.UNKNOWN_AGENT_TYPE);
      expect(preparation).toMatchObject({
        message: "agentType 'SOMETHING_NEW' 는 retry-run 이 지원되지 않습니다.",
      });
    });

    it('추가 컨텍스트가 붙은 PO_SHADOW 는 재현할 수 없어 NOT_REPRODUCIBLE', async () => {
      const { prepare } = setup(
        failedRun('PO_SHADOW', { extraContextLength: 10 }),
      );
      expectRejected(await prepare(), ReplayRejectionCode.NOT_REPRODUCIBLE);
    });

    it('영상 정보가 없는 VIDEO_WATCH 는 NOT_REPRODUCIBLE', async () => {
      const { prepare } = setup(failedRun('VIDEO_WATCH', { question: '요약' }));
      expectRejected(await prepare(), ReplayRejectionCode.NOT_REPRODUCIBLE);
    });

    it('이미 주문을 남긴 PAPER_RECOMMEND 는 중복 방지로 NOT_REPRODUCIBLE', async () => {
      const { prepare, paperTradingRepository } = setup(
        failedRun('PAPER_RECOMMEND', {
          strategy: 'SWING',
          decidedAt: '2026-10-08T00:00:00.000Z',
        }),
      );
      paperTradingRepository.hasOrdersForRecommendation.mockResolvedValue(true);
      expectRejected(await prepare(), ReplayRejectionCode.NOT_REPRODUCIBLE);
    });
  });

  describe('실행', () => {
    // 판정과 실행을 나눈 이유 — Slack 은 ack 뒤에, 콘솔은 202 뒤에 돌린다.
    it('판정만으로는 아무것도 실행하지 않는다', async () => {
      const { prepare, generateDailyPlanUsecase } = setup(
        failedRun('PM', { slackUserId: OWNER, tasksText: '할 일' }),
      );
      const preparation = await prepare();
      expect(preparation).toMatchObject({ kind: 'READY', agentType: 'PM' });
      expect(generateDailyPlanUsecase.execute).not.toHaveBeenCalled();
    });

    it('PM 은 원래 입력으로 FAILURE_REPLAY 를 돌리고 새 run 을 원본의 자식으로 잇는다', async () => {
      const { prepare, generateDailyPlanUsecase, agentRunService } = setup(
        failedRun('PM', { slackUserId: OWNER, tasksText: '할 일' }),
      );
      const preparation = await prepare();
      if (preparation.kind !== 'READY') {
        throw new Error('READY 여야 한다');
      }

      await preparation.run();

      expect(generateDailyPlanUsecase.execute).toHaveBeenCalledWith({
        tasksText: '할 일',
        slackUserId: OWNER,
        triggerType: TriggerType.FAILURE_REPLAY,
      });
      expect(agentRunService.setParentId).toHaveBeenCalledWith({
        id: 99,
        parentId: 42,
      });
    });

    it('스냅샷에 사용자가 없으면 요청자 명의로 돌린다(스케줄 실행)', async () => {
      const { prepare, generateWorklogUsecase } = setup(
        failedRun('WORK_REVIEWER', { workText: '한 일' }),
      );
      const preparation = await prepare();
      if (preparation.kind !== 'READY') {
        throw new Error('READY 여야 한다');
      }
      await preparation.run();
      expect(generateWorklogUsecase.execute).toHaveBeenCalledWith({
        workText: '한 일',
        slackUserId: OWNER,
      });
    });

    it('CODE_REVIEWER 는 최초 실행이 게시하기로 한 경우에만 다시 게시한다', async () => {
      const { prepare, reviewPullRequestUsecase } = setup(
        failedRun('CODE_REVIEWER', { prRef: 'o/r#1' }),
      );
      const preparation = await prepare();
      if (preparation.kind !== 'READY') {
        throw new Error('READY 여야 한다');
      }
      await preparation.run();
      expect(reviewPullRequestUsecase.execute).toHaveBeenCalledWith({
        prRef: 'o/r#1',
        slackUserId: OWNER,
        publish: false,
      });
    });

    it('계보 연결이 실패해도 재실행 결과는 그대로 돌려준다', async () => {
      const { prepare, agentRunService } = setup(
        failedRun('CEO', { range: 'TODAY' }),
      );
      agentRunService.setParentId.mockRejectedValue(new Error('DB 흔들림'));
      const preparation = await prepare();
      if (preparation.kind !== 'READY') {
        throw new Error('READY 여야 한다');
      }
      await expect(preparation.run()).resolves.toMatchObject({
        agentRunId: 99,
      });
    });
  });

  // Slack `/retry-run` 과 콘솔 버튼이 이 판정을 함께 지나므로 잠금도 여기 하나다 — 진입점마다
  // 따로 잠그면 두 곳에서 동시에 누른 같은 run 이 두 번 돌아 게시 리뷰·발행 카드가 두 벌 나간다.
  describe('중복 실행 잠금', () => {
    const readyOf = async (preparation: Promise<ReplayPreparation>) => {
      const resolved = await preparation;
      if (resolved.kind !== 'READY') {
        throw new Error(`READY 여야 한다: ${JSON.stringify(resolved)}`);
      }
      return resolved;
    };

    it('같은 run 의 재실행이 도는 동안 다른 진입점의 요청은 IN_FLIGHT, 끝나면 다시 받는다', async () => {
      const { prepare, generateDailyPlanUsecase } = setup(failedRun('PM'));
      let finish: (value: unknown) => void = () => undefined;
      generateDailyPlanUsecase.execute.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );

      const first = await readyOf(prepare());
      const running = first.run();
      expectRejected(await prepare(), ReplayRejectionCode.IN_FLIGHT);

      finish(outcome(99));
      await running;
      expect(await prepare()).toMatchObject({ kind: 'READY' });
    });

    it('판정을 기다리는 사이 들어온 두 번째 요청도 막는다', async () => {
      const { prepare } = setup(failedRun('PM'));

      const [first, second] = await Promise.all([prepare(), prepare()]);

      expect(first).toMatchObject({ kind: 'READY' });
      expectRejected(second, ReplayRejectionCode.IN_FLIGHT);
    });

    it('판정이 거절되면 잠금을 푼다', async () => {
      const { prepare } = setup(failedRun('VACATION'));
      expectRejected(await prepare(), ReplayRejectionCode.NOT_SUPPORTED);
      expectRejected(await prepare(), ReplayRejectionCode.NOT_SUPPORTED);
    });

    it('판정이 예외로 끝나도 잠금을 풀어 다음 요청을 받는다', async () => {
      const { prepare, retryRunUsecase } = setup(failedRun('PM'));
      retryRunUsecase.execute.mockRejectedValueOnce(new Error('DB 흔들림'));

      await expect(prepare()).rejects.toThrow('DB 흔들림');
      expect(await prepare()).toMatchObject({ kind: 'READY' });
    });

    it('실행이 실패해도 잠금을 푼다', async () => {
      const { prepare, generateDailyPlanUsecase } = setup(failedRun('PM'));
      generateDailyPlanUsecase.execute.mockRejectedValueOnce(
        new Error('codex 실패'),
      );

      await expect((await readyOf(prepare())).run()).rejects.toThrow(
        'codex 실패',
      );
      expect(await prepare()).toMatchObject({ kind: 'READY' });
    });
  });

  // 브리핑의 버튼 표시와 실제 판정이 같은 목록을 보는지 — 어긋나면 버튼이 떠도 눌리지 않는다.
  it('REPLAYABLE_AGENT_TYPES 의 모든 종류는 기본 입력에서 READY 로 판정된다', async () => {
    const snapshots: Record<string, object> = {
      VIDEO_WATCH: { videoId: 'jNQXAC9IVRw' },
      PAPER_RECOMMEND: {
        strategy: 'SWING',
        decidedAt: '2026-10-08T00:00:00.000Z',
      },
    };
    for (const agentType of REPLAYABLE_AGENT_TYPES) {
      const { prepare } = setup(
        failedRun(agentType, snapshots[agentType] ?? {}),
      );
      expect(await prepare()).toMatchObject({ kind: 'READY', agentType });
    }
  });
});
