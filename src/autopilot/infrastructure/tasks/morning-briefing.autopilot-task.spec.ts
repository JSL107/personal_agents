import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { GenerateDailyPlanUsecase } from '../../../agent/pm/application/generate-daily-plan.usecase';
import { PmAgentException } from '../../../agent/pm/domain/pm-agent.exception';
import { PmAgentErrorCode } from '../../../agent/pm/domain/pm-agent-error-code.enum';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { ListSchedulesInput } from '../../../schedule/application/list-schedules.usecase';
import {
  ScheduleItemRecord,
  ScheduleStatus,
} from '../../../schedule/domain/schedule.type';
import { buildScheduleItemRecord } from '../../../schedule/domain/schedule-item.fixture';
import { MorningBriefingAutopilotTask } from './morning-briefing.autopilot-task';

const NO_TRUNCATION = {
  github: 0,
  notion: 0,
  slackMentions: 0,
  inboxItems: 0,
  droppedSections: [],
};

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };

const mockTask = {
  id: 'task-1',
  title: '작업1',
  source: 'github' as const,
  subtasks: [],
  isCriticalPath: false,
};

// 자산 줄은 곁다리다. 기존 테스트는 보유 0건 대역으로 두어 브리핑 본문만 본다.
const emptyStockRepository = () =>
  ({
    findPortfolioPositions: jest.fn().mockResolvedValue([]),
    findLatestFxRate: jest.fn().mockResolvedValue(null),
  }) as never;

// 마감 줄도 곁다리다. 기존 테스트는 항목 0건 대역으로 두어 브리핑 본문만 본다.
const listSchedulesUsecase = () =>
  ({
    execute: jest.fn().mockResolvedValue([]),
  }) as never;

// 아침 한 통의 다른 줄(승인·장애·공고·투자·공부·포트폴리오) 재료. 기본은 전부 비어 있어
// 계획 전문만 보는 테스트가 그대로 돈다.
const emptyDigestRepository = () => ({
  findOpenIncidents: jest.fn().mockResolvedValue([]),
  findResolvedIncidentLabels: jest.fn().mockResolvedValue([]),
  findLatestStudyBrief: jest.fn().mockResolvedValue(null),
  findLatestConsoleText: jest.fn().mockResolvedValue(null),
  countDuePaperOrders: jest
    .fn()
    .mockResolvedValue({ buyCount: 0, sellCount: 0 }),
});

interface DigestDeps {
  cujLedgerReader?: { findLatestDeliveryBefore: jest.Mock };
  findAllOpenPreviews?: { execute: jest.Mock };
  listNotifiable?: { execute: jest.Mock };
  jobPostingRepository?: Record<string, jest.Mock>;
  digestRepository?: Record<string, jest.Mock>;
  config?: Record<string, string>;
  verdictRepository?: { findRunsForVerdictDigest: jest.Mock };
  deliveryRepository?: { findSince: jest.Mock };
  buildMorningTodos?: {
    execute: jest.Mock;
    reconcileBeforeListing?: jest.Mock;
  };
}

const buildTask = (
  generateDailyPlan: unknown,
  humanizeService: unknown,
  stockRepository: unknown,
  listSchedules: unknown,
  deps: DigestDeps = {},
): MorningBriefingAutopilotTask =>
  new MorningBriefingAutopilotTask(
    generateDailyPlan as never,
    humanizeService as never,
    stockRepository as never,
    listSchedules as never,
    (deps.findAllOpenPreviews ?? {
      execute: jest.fn().mockResolvedValue([]),
    }) as never,
    (deps.listNotifiable ?? {
      execute: jest.fn().mockResolvedValue([]),
    }) as never,
    (deps.jobPostingRepository ?? {
      findLastCollectedAt: jest.fn().mockResolvedValue(new Date()),
      claimForNotification: jest.fn().mockResolvedValue(true),
    }) as never,
    (deps.digestRepository ?? emptyDigestRepository()) as never,
    {
      get: (key: string) =>
        deps.config?.[key] ??
        (key === 'CONSOLE_OWNER_SLACK_USER_ID' ? 'U1' : undefined),
    } as never,
    (deps.cujLedgerReader ?? {
      findLatestDeliveryBefore: jest.fn().mockResolvedValue(null),
    }) as never,
    (deps.verdictRepository ?? {
      findRunsForVerdictDigest: jest.fn().mockResolvedValue([]),
    }) as never,
    (deps.deliveryRepository ?? {
      findSince: jest.fn().mockResolvedValue([]),
    }) as never,
    {
      reconcileBeforeListing: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue({
        loadFailed: false,
        today: [],
        waiting: [],
        unstarted: [],
      }),
      ...deps.buildMorningTodos,
    } as never,
  );

const basePlan = {
  topPriority: mockTask,
  morning: [mockTask],
  afternoon: [],
  blocker: null,
  estimatedHours: 4,
  reasoning: '테스트 계획',
  varianceAnalysis: { rolledOverTasks: [], analysisReasoning: '' },
};

describe('MorningBriefingAutopilotTask', () => {
  describe('원장 결번 감시', () => {
    // 회차 2026-10-17(토) → 어제는 10-16. 오늘 0시(KST) = 2026-10-16T15:00Z.
    const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-10-17' };
    // 감시 대상별 마지막 기록. 없는 대상은 기준점 없음(null).
    const latestBy =
      (latest: Record<string, Date | Error>) =>
      async (itemKind: string): Promise<Date | null> => {
        const value = latest[itemKind];
        if (value instanceof Error) {
          throw value;
        }
        return value ?? null;
      };
    const runWith = async (
      findLatestDeliveryBefore: jest.Mock,
      firedAtKst = context.firedAtKst,
      config: Record<string, string> = {},
    ): Promise<string> => {
      const task = buildTask(
        { execute: jest.fn().mockRejectedValue(new Error('계획 장애')) },
        { humanize: jest.fn() },
        emptyStockRepository(),
        listSchedulesUsecase(),
        { cujLedgerReader: { findLatestDeliveryBefore }, config },
      );
      const result = await task.run({ ...context, firedAtKst });
      return result.summaryText ?? '';
    };

    it('CUJ 점검 어제 기록이 없으면 마지막 기록일과 함께 장애 줄에 싣는다', async () => {
      const find = jest
        .fn()
        .mockImplementation(
          latestBy({ 'cuj-check': new Date('2026-10-15T00:10:00Z') }),
        );

      const text = await runWith(find);

      expect(text).toContain('CUJ 점검 기록 없음, 마지막 기록 10/15(목)');
    });

    it('오늘 0시 이전 기록만 묻는다 — 늦게 돈 회차에서 오늘 실행이 지난 결번을 가리지 않게', async () => {
      const find = jest.fn().mockResolvedValue(null);

      await runWith(find);

      expect(find).toHaveBeenCalledWith(
        'cuj-check',
        new Date('2026-10-16T15:00:00Z'),
      );
      for (const taskId of [
        'run-retro',
        'weekly-summary',
        'impact-report',
        'knowledge-lint',
        'blog-revision-report',
      ]) {
        expect(find).toHaveBeenCalledWith(
          taskId,
          new Date('2026-10-16T15:00:00Z'),
        );
      }
    });

    it('어제 기록이 있으면 조용하다', async () => {
      const find = jest
        .fn()
        .mockImplementation(
          latestBy({ 'cuj-check': new Date('2026-10-16T00:10:00Z') }),
        );

      expect(await runWith(find)).not.toContain('CUJ 점검');
    });

    it('기록이 한 번도 없으면(첫 실행 전) 조용하다', async () => {
      const text = await runWith(jest.fn().mockResolvedValue(null));

      expect(text).not.toContain('CUJ 점검');
      expect(text).not.toContain('주간 실행 회고');
    });

    it('월요일 주간 실행 회고가 빠지면 화요일 아침에 싣는다', async () => {
      const find = jest
        .fn()
        .mockImplementation(
          latestBy({ 'run-retro': new Date('2026-10-12T00:00:00Z') }),
        );

      const text = await runWith(find, '2026-10-20');

      expect(text).toContain('주간 실행 회고 기록 없음, 마지막 기록 10/12(월)');
    });

    it('주간 실행 회고는 회차 전인 다음 월요일 아침까지 조용하다', async () => {
      const find = jest
        .fn()
        .mockImplementation(
          latestBy({ 'run-retro': new Date('2026-10-12T00:00:00Z') }),
        );

      expect(await runWith(find, '2026-10-19')).not.toContain('주간 실행 회고');
    });

    it('스케줄 env 오버라이드로 판정한다 — 더 드문 cron 이면 다음 회차 전까지 조용하다', async () => {
      const find = jest
        .fn()
        .mockImplementation(
          latestBy({ 'run-retro': new Date('2026-10-01T00:00:00Z') }),
        );

      expect(await runWith(find, '2026-10-10')).toContain(
        '주간 실행 회고 기록 없음',
      );
      expect(
        await runWith(find, '2026-10-10', {
          AUTOPILOT_RUN_RETRO_SCHEDULE: '0 9 1,15 * *',
        }),
      ).not.toContain('주간 실행 회고');
    });

    it('cron 오버라이드가 잘못되면 그 대상 줄만 빠진다', async () => {
      const find = jest.fn().mockImplementation(
        latestBy({
          'cuj-check': new Date('2026-10-15T00:10:00Z'),
          'run-retro': new Date('2026-10-05T00:00:00Z'),
        }),
      );

      const text = await runWith(find, context.firedAtKst, {
        AUTOPILOT_CUJ_CHECK_SCHEDULE: 'bad cron',
      });

      expect(text).not.toContain('CUJ 점검');
      expect(text).toContain('주간 실행 회고 기록 없음');
    });

    it('한 대상의 조회가 실패해도 브리핑과 다른 대상의 줄은 나간다', async () => {
      const find = jest.fn().mockImplementation(
        latestBy({
          'cuj-check': new Error('원장 장애'),
          'run-retro': new Date('2026-10-05T00:00:00Z'),
        }),
      );

      const text = await runWith(find);

      expect(text).not.toContain('CUJ 점검');
      expect(text).toContain('주간 실행 회고 기록 없음');
      expect(text).toContain('오늘 계획 생성 실패');
      expect(text).not.toContain('계획 장애');
    });
  });

  it('id 는 morning-briefing', () => {
    const humanizeService = { humanize: jest.fn() };
    const task = buildTask(
      {} as never,
      humanizeService as unknown as HumanizeService,
      emptyStockRepository(),
      listSchedulesUsecase(),
    );
    expect(task.id).toBe('morning-briefing');
  });

  it('ctx owner와 CONSOLE_OWNER가 다르면 경고하고 저장소 owner로 목록을 만든다', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const buildMorningTodos = {
      execute: jest.fn().mockResolvedValue({
        loadFailed: false,
        today: [],
        waiting: [],
        unstarted: [],
      }),
    };
    const task = buildTask(
      { execute: jest.fn().mockRejectedValue(new Error('계획 실패')) },
      { humanize: jest.fn() },
      emptyStockRepository(),
      listSchedulesUsecase(),
      { config: { CONSOLE_OWNER_SLACK_USER_ID: 'U2' }, buildMorningTodos },
    );

    await task.run(CTX);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('U1'));
    expect(buildMorningTodos.execute).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'U2', kstDate: CTX.firedAtKst }),
    );
    warn.mockRestore();
  });

  it('PM 목록 대신 저장소 목록을 내고 run 안에서 저장한다', async () => {
    const buildMorningTodos = {
      execute: jest.fn().mockResolvedValue({
        loadFailed: false,
        today: [{ title: '저장소 작업', url: null, dayCount: 2, detail: null }],
        waiting: [],
        unstarted: [],
      }),
    };
    const task = buildTask(
      {
        execute: jest.fn().mockResolvedValue({
          result: {
            plan: basePlan,
            sources: [],
            waitingItems: [],
            inputTruncation: NO_TRUNCATION,
          },
          agentRunId: 1,
        }),
      },
      {
        humanize: jest
          .fn()
          .mockResolvedValue({ reasoning: '계획', analysisReasoning: '' }),
      },
      emptyStockRepository(),
      listSchedulesUsecase(),
      { buildMorningTodos },
    );

    const result = await task.run(CTX);

    expect(buildMorningTodos.execute).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'U1', kstDate: CTX.firedAtKst }),
    );
    expect(result.summaryText).toContain('• 저장소 작업 (2일째)');
    expect(result.summaryText).not.toContain('• 작업1');
  });

  it('run 시작에 PR 정합을 먼저 실행하고 목록은 마지막에 만든다', async () => {
    const buildMorningTodos = {
      reconcileBeforeListing: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue({
        loadFailed: false,
        today: [],
        waiting: [],
        unstarted: [],
      }),
    };
    const plan = {
      execute: jest.fn().mockRejectedValue(new Error('계획 실패')),
    };
    const task = buildTask(
      plan,
      { humanize: jest.fn() },
      emptyStockRepository(),
      listSchedulesUsecase(),
      { buildMorningTodos },
    );

    await task.run(CTX);

    expect(buildMorningTodos.reconcileBeforeListing).toHaveBeenCalledWith({
      ownerId: 'U1',
      now: expect.any(Date),
    });
    expect(buildMorningTodos.execute).toHaveBeenCalledWith(
      expect.objectContaining({ alreadyReconciled: true }),
    );
    expect(
      buildMorningTodos.reconcileBeforeListing.mock.invocationCallOrder[0],
    ).toBeLessThan(plan.execute.mock.invocationCallOrder[0]);
    expect(plan.execute.mock.invocationCallOrder[0]).toBeLessThan(
      buildMorningTodos.execute.mock.invocationCallOrder[0],
    );
  });

  it('본문 상한 이내의 오늘·대기 목록은 스레드에 반복하지 않고 시작 안 한 일은 싣는다', async () => {
    const todo = { title: '오늘 업무', url: null, dayCount: 2, detail: null };
    const waiting = {
      title: '리뷰 업무',
      url: null,
      dayCount: 3,
      detail: '리뷰 대기',
    };
    const unstarted = {
      title: '시작 전 업무',
      url: null,
      dayCount: 1,
      detail: null,
    };
    const task = buildTask(
      { execute: jest.fn().mockRejectedValue(new Error('계획 실패')) },
      { humanize: jest.fn() },
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        buildMorningTodos: {
          execute: jest.fn().mockResolvedValue({
            loadFailed: false,
            today: [todo],
            waiting: [waiting],
            unstarted: [unstarted],
          }),
        },
      },
    );

    const result = await task.run(CTX);

    expect(result.detailText).not.toContain('*오늘 할 일 전체*');
    expect(result.detailText).not.toContain('*남 기다리는 일 전체*');
    expect(result.detailText).toContain('*시작 안 한 일*\n• 시작 전 업무');
  });

  it('이미 발송된 아침이면 목록 작성에 전달 완료를 알린다', async () => {
    const buildMorningTodos = {
      execute: jest.fn().mockResolvedValue({
        loadFailed: false,
        today: [],
        waiting: [],
        unstarted: [],
      }),
    };
    const deliveryRepository = {
      findSince: jest.fn().mockResolvedValue([
        {
          kind: 'autopilot:morning',
          itemKinds: ['morning-briefing'],
          threadTs: null,
          status: 'SENT',
        },
      ]),
    };
    const task = buildTask(
      { execute: jest.fn().mockRejectedValue(new Error('계획 실패')) },
      { humanize: jest.fn() },
      emptyStockRepository(),
      listSchedulesUsecase(),
      { buildMorningTodos, deliveryRepository },
    );

    await task.run(CTX);

    expect(deliveryRepository.findSince).toHaveBeenCalledWith(
      new Date('2026-06-16T15:00:00.000Z'),
      new Date('2026-06-17T15:00:00.000Z'),
    );
    expect(buildMorningTodos.execute).toHaveBeenCalledWith(
      expect.objectContaining({ alreadyDelivered: true }),
    );
  });

  it('대기 업무가 본문 상한을 넘으면 전체 목록을 스레드에 싣는다', async () => {
    const waiting = Array.from({ length: 4 }, (_, index) => ({
      title: `대기 업무 ${index + 1}`,
      url: null,
      dayCount: 1,
      detail: '리뷰 대기',
    }));
    const task = buildTask(
      { execute: jest.fn().mockRejectedValue(new Error('계획 실패')) },
      { humanize: jest.fn() },
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        buildMorningTodos: {
          execute: jest.fn().mockResolvedValue({
            loadFailed: false,
            today: [],
            waiting,
            unstarted: [],
          }),
        },
      },
    );

    const result = await task.run(CTX);

    expect(result.summaryText).toContain('• 외 1개');
    expect(result.detailText).toContain('*남 기다리는 일 전체*');
    expect(result.detailText).toContain('• 대기 업무 4 (리뷰 대기)');
  });

  it('CONSOLE_OWNER가 없으면 저장소 실패만 알리고 PM 실패로 오해하지 않는다', async () => {
    const buildMorningTodos = {
      execute: jest.fn().mockResolvedValue({
        loadFailed: true,
        today: [],
        waiting: [],
        unstarted: [],
      }),
    };
    const task = buildTask(
      {
        execute: jest.fn().mockResolvedValue({
          result: {
            plan: basePlan,
            sources: [],
            waitingItems: [],
            inputTruncation: NO_TRUNCATION,
          },
          agentRunId: 1,
        }),
      },
      {
        humanize: jest
          .fn()
          .mockResolvedValue({ reasoning: '계획', analysisReasoning: '' }),
      },
      emptyStockRepository(),
      listSchedulesUsecase(),
      { config: { CONSOLE_OWNER_SLACK_USER_ID: '' }, buildMorningTodos },
    );

    const result = await task.run(CTX);

    expect(buildMorningTodos.execute).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: null }),
    );
    expect(result.summaryText).toContain('• 오늘 할 일을 불러오지 못했어요');
    expect(result.summaryText).not.toContain('오늘 계획 생성 실패');
  });

  it('PM 계획 성공 시 summaryText 반환(skip=false)', async () => {
    const execute = jest.fn().mockResolvedValue({
      result: {
        plan: basePlan,
        sources: [],
        waitingItems: [],
        inputTruncation: NO_TRUNCATION,
      },
      modelUsed: 'codex-cli',
      agentRunId: 10,
    });
    const humanizeService = {
      humanize: jest
        .fn()
        .mockResolvedValue({ reasoning: '테스트 계획', analysisReasoning: '' }),
    };
    const task = buildTask(
      { execute } as never,
      humanizeService as unknown as HumanizeService,
      emptyStockRepository(),
      listSchedulesUsecase(),
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toBeTruthy();
    // 메인에는 할 일만 싣고 PM 계획 전문은 보내지 않는다.
    expect(out.summaryText).not.toContain('*판단 근거*');
    expect(out.summaryText).toContain('☀️ *6/17(수) 아침*');
    expect(out.summaryText).toContain('*오늘 할 일*\n• 오늘 할 일이 없어요');
    expect(out.detailText).toBe('');
    expect(out.summaryText).not.toContain('codex-cli');
    expect(out.summaryText).not.toContain('run #');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1', tasksText: '' }),
    );
  });

  it('plan 을 윤문해도 PM 할 일은 summaryText 에 싣지 않는다', async () => {
    const outcome = {
      result: {
        plan: basePlan,
        sources: [],
        waitingItems: [
          { title: 'PR1', url: 'https://x/1', reason: '머지만 남음' },
        ],
        inputTruncation: NO_TRUNCATION,
      },
      modelUsed: 'chatgpt',
      agentRunId: 1,
    };
    const generateDailyPlan = { execute: jest.fn().mockResolvedValue(outcome) };
    const humanizeService = {
      humanize: jest
        .fn()
        .mockResolvedValue({ reasoning: '윤문', analysisReasoning: '윤문' }),
    };
    const task = buildTask(
      generateDailyPlan as unknown as GenerateDailyPlanUsecase,
      humanizeService as unknown as HumanizeService,
      emptyStockRepository(),
      listSchedulesUsecase(),
    );
    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-06-30',
    });
    expect(result.summaryText).toContain('*오늘 할 일*\n• 오늘 할 일이 없어요');
    expect(result.summaryText).not.toContain('• 작업1');
    expect(result.summaryText).not.toContain('*판단 근거*');
    expect(result.summaryText).not.toContain('머지만 남음');
    expect(result.detailText).toBe('');
  });

  it('할 일이 여섯 개면 전문을 공고 스레드보다 먼저 싣는다', async () => {
    const todos = Array.from({ length: 6 }, (_, index) => ({
      title: `작업 ${index + 1}`,
      url: null,
      dayCount: 1,
      detail: null,
    }));
    const task = buildTask(
      {
        execute: jest.fn().mockResolvedValue({
          result: {
            plan: basePlan,
            sources: [],
            waitingItems: [],
            inputTruncation: NO_TRUNCATION,
          },
          agentRunId: 1,
        }),
      },
      {
        humanize: jest
          .fn()
          .mockResolvedValue({ reasoning: '계획', analysisReasoning: '' }),
      },
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        config: { JOB_FEED_ENABLED: 'true' },
        buildMorningTodos: {
          execute: jest.fn().mockResolvedValue({
            loadFailed: false,
            today: todos,
            waiting: [],
            unstarted: [],
          }),
        },
        listNotifiable: {
          execute: jest.fn().mockResolvedValue([
            {
              source: 'jumpit',
              sourceId: 'a',
              company: 'A',
              title: '개발자',
              normalizedKey: 'a',
              detailUrl: 'https://jumpit.example/a',
              skillTags: ['NestJS'],
              locations: ['서울'],
              minYears: 3,
              maxYears: 7,
              matchScore: 92,
            },
          ]),
        },
      },
    );

    const out = await task.run(CTX);

    expect(out.summaryText).toContain('• 외 1개');
    expect(out.detailText).toContain('*오늘 할 일 전체*');
    expect(out.detailText).toContain('• 작업 6');
    expect(out.detailText!.indexOf('*오늘 할 일 전체*')).toBeLessThan(
      out.detailText!.indexOf('*새 백엔드 공고 1건*'),
    );
  });

  describe('주간 판정 카드 — 월요일 아침에만, 지난주 판정 안 된 실행을 싣는다', () => {
    const planTask = () =>
      ({
        execute: jest.fn().mockRejectedValue(new Error('계획 실패')),
      }) as never;
    const humanize = () => ({ humanize: jest.fn() }) as never;

    const morningSent = {
      kind: 'autopilot:morning',
      itemKinds: ['morning-briefing'],
      threadTs: null,
      status: 'SENT',
    };

    it('월요일이면 지난주 월 0시 ~ 이번 주 월 0시(KST) 실행을 묻고 축별 카드를 싣는다', async () => {
      const findRunsForVerdictDigest = jest.fn().mockResolvedValue([
        {
          id: 7,
          agentType: 'PM',
          // 10-27(화) 08:00 KST
          startedAt: new Date('2026-10-26T23:00:00.000Z'),
          output: {
            topPriority: { title: '감사로그 요구사항 작성' },
            morning: [],
          },
          judgedFacets: [],
        },
        {
          id: 8,
          agentType: 'PM',
          startedAt: new Date('2026-10-27T23:00:00.000Z'),
          output: { topPriority: { title: '이미 판정됨' } },
          judgedFacets: ['pm_plan'],
        },
      ]);
      const task = buildTask(
        planTask(),
        humanize(),
        emptyStockRepository(),
        listSchedulesUsecase(),
        {
          verdictRepository: { findRunsForVerdictDigest },
          deliveryRepository: {
            findSince: jest.fn().mockResolvedValue([morningSent]),
          },
        },
      );

      const result = await task.run({
        ownerSlackUserId: 'U1',
        firedAtKst: '2026-11-02',
      });

      expect(findRunsForVerdictDigest).toHaveBeenCalledWith({
        slackUserId: 'U1',
        since: new Date('2026-10-25T15:00:00.000Z'),
        until: new Date('2026-11-01T15:00:00.000Z'),
      });
      expect(result.verdictCards).toHaveLength(1);
      expect(result.verdictCards?.[0].text).toBe(
        '🗓️ 아침 계획 주간 판정: 지난주 판정 안 된 1건',
      );
      expect(JSON.stringify(result.verdictCards?.[0].blocks)).toContain(
        '*10/27(화)*\\n*아침 계획*\\n> 감사로그 요구사항 작성',
      );
    });

    it('아침 메시지가 나가지 않은 날의 계획은 묻지 않는다 — 본 적 없는 계획이다', async () => {
      const findSince = jest
        .fn()
        // 10-27: 아침 본문이 실패, 10-28: 정상 발송
        .mockResolvedValueOnce([{ ...morningSent, status: 'FAILED' }])
        .mockResolvedValueOnce([morningSent]);
      const task = buildTask(
        planTask(),
        humanize(),
        emptyStockRepository(),
        listSchedulesUsecase(),
        {
          verdictRepository: {
            findRunsForVerdictDigest: jest.fn().mockResolvedValue([
              {
                id: 7,
                agentType: 'PM',
                startedAt: new Date('2026-10-26T23:00:00.000Z'),
                output: { topPriority: { title: 'A' } },
                judgedFacets: [],
              },
              {
                id: 8,
                agentType: 'PM',
                startedAt: new Date('2026-10-27T23:00:00.000Z'),
                output: { topPriority: { title: 'B' } },
                judgedFacets: [],
              },
            ]),
          },
          deliveryRepository: { findSince },
        },
      );

      const result = await task.run({
        ownerSlackUserId: 'U1',
        firedAtKst: '2026-11-02',
      });

      expect(findSince).toHaveBeenNthCalledWith(
        1,
        new Date('2026-10-26T15:00:00.000Z'),
        new Date('2026-10-27T15:00:00.000Z'),
      );
      const body = JSON.stringify(result.verdictCards?.[0].blocks);
      expect(body).not.toContain('> A');
      expect(body).toContain('> B');
    });

    it('저녁 회고·PO 도 그날 결과가 실제로 나간 실행만 묻는다 — 발송이 실패한 날은 뺀다', async () => {
      const retro = (id: number, startedAt: string) => ({
        id,
        agentType: 'EVENING_RETRO',
        startedAt: new Date(startedAt),
        output: { retrospective: { problem: `문제 ${id}` } },
        judgedFacets: [],
      });
      const findSince = jest
        .fn()
        // 10-27: 저녁 본문 실패(기록 없음), 10-28: 회고 상세 댓글까지 SENT
        .mockResolvedValueOnce([morningSent])
        .mockResolvedValueOnce([
          {
            kind: 'autopilot:evening',
            itemKinds: ['evening-retro-publish'],
            threadTs: '1.0',
            status: 'SENT',
          },
        ]);
      const task = buildTask(
        planTask(),
        humanize(),
        emptyStockRepository(),
        listSchedulesUsecase(),
        {
          verdictRepository: {
            findRunsForVerdictDigest: jest
              .fn()
              .mockResolvedValue([
                retro(1, '2026-10-27T10:00:00.000Z'),
                retro(2, '2026-10-28T10:00:00.000Z'),
              ]),
          },
          deliveryRepository: { findSince },
        },
      );

      const result = await task.run({
        ownerSlackUserId: 'U1',
        firedAtKst: '2026-11-02',
      });

      expect(result.verdictCards).toHaveLength(1);
      const body = JSON.stringify(result.verdictCards?.[0].blocks);
      expect(body).not.toContain('문제 1');
      expect(body).toContain('문제 2');
      expect(result.verdictCards?.[0].text).toBe(
        '🌙 저녁 회고 주간 판정: 지난주 판정 안 된 1건',
      );
    });

    it('월요일이 아니면 조회하지 않는다', async () => {
      const findRunsForVerdictDigest = jest.fn();
      const task = buildTask(
        planTask(),
        humanize(),
        emptyStockRepository(),
        listSchedulesUsecase(),
        { verdictRepository: { findRunsForVerdictDigest } },
      );

      const result = await task.run({
        ownerSlackUserId: 'U1',
        firedAtKst: '2026-11-03',
      });

      expect(findRunsForVerdictDigest).not.toHaveBeenCalled();
      expect(result.verdictCards).toBeUndefined();
    });

    it('조회가 실패해도 아침 한 통은 나가고 카드만 빠진다', async () => {
      const task = buildTask(
        planTask(),
        humanize(),
        emptyStockRepository(),
        listSchedulesUsecase(),
        {
          verdictRepository: {
            findRunsForVerdictDigest: jest
              .fn()
              .mockRejectedValue(new Error('DB 끊김')),
          },
        },
      );

      const result = await task.run({
        ownerSlackUserId: 'U1',
        firedAtKst: '2026-11-02',
      });

      expect(result.skip).toBe(false);
      expect(result.verdictCards).toBeUndefined();
    });
  });

  it('EMPTY_TASKS_INPUT 면 안내문 반환(skip=false)', async () => {
    const execute = jest.fn().mockRejectedValue(
      new PmAgentException({
        code: PmAgentErrorCode.EMPTY_TASKS_INPUT,
        message: '없음',
        status: DomainStatus.UNPROCESSABLE_ENTITY,
      }),
    );
    const humanizeService = { humanize: jest.fn() };
    const task = buildTask(
      { execute } as never,
      humanizeService as unknown as HumanizeService,
      emptyStockRepository(),
      listSchedulesUsecase(),
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('• 오늘 할 일이 없어요');
  });

  describe('자산 한 줄', () => {
    const outcome = {
      result: {
        plan: basePlan,
        sources: [],
        waitingItems: [],
        inputTruncation: NO_TRUNCATION,
      },
      modelUsed: 'codex-cli',
      agentRunId: 10,
    };
    const humanize = {
      humanize: jest
        .fn()
        .mockResolvedValue({ reasoning: '테스트', analysisReasoning: '' }),
    };
    const holding = {
      region: 'KR',
      direction: 'LONG',
      currency: 'KRW',
      quantity: new Prisma.Decimal('10'),
      close: new Prisma.Decimal('120'),
      avgPrice: new Prisma.Decimal('100'),
      previousClose: new Prisma.Decimal('110'),
      holdingDate: new Date(),
    };
    const runWith = async (
      positions: unknown,
      rate: unknown = null,
      plan: unknown = outcome,
    ) => {
      const task = buildTask(
        {
          execute:
            plan instanceof Error
              ? jest.fn().mockRejectedValue(plan)
              : jest.fn().mockResolvedValue(plan),
        },
        humanize,
        {
          findPortfolioPositions:
            positions instanceof Error
              ? jest.fn().mockRejectedValue(positions)
              : jest.fn().mockResolvedValue(positions),
          findLatestFxRate: jest.fn().mockResolvedValue(rate),
        },
        listSchedulesUsecase(),
      );
      return await task.run(CTX);
    };

    it('보유가 있으면 그 밖에 자산 한 줄을 낸다', async () => {
      const out = await runWith([holding]);
      expect(out.summaryText).toContain(
        '*그 밖에*\n• 자산: 1,200원 · 매입가 대비',
      );
      expect(out.summaryText).not.toContain('내 자산');
    });
    it('자산 조회가 실패해도 본문을 보낸다', async () => {
      const out = await runWith(new Error('DB 끊김'));
      expect(out.skip).toBe(false);
      expect(out.summaryText).toContain('*오늘 할 일*');
      expect(out.summaryText).not.toContain('• 자산:');
    });
    it('할 일이 없는 날에도 자산을 보낸다', async () => {
      const empty = new PmAgentException({
        code: PmAgentErrorCode.EMPTY_TASKS_INPUT,
        message: '수집된 할 일 없음',
        status: DomainStatus.UNPROCESSABLE_ENTITY,
      });
      const out = await runWith([holding], null, empty);
      expect(out.summaryText).toContain('• 오늘 할 일이 없어요');
      expect(out.summaryText).toContain('• 자산:');
    });
    it('최근 환율로 달러 보유를 환산한다', async () => {
      const out = await runWith(
        [
          {
            ...holding,
            currency: 'USD',
            quantity: new Prisma.Decimal('100'),
            close: new Prisma.Decimal('10'),
            avgPrice: new Prisma.Decimal('8'),
            previousClose: new Prisma.Decimal('9'),
          },
        ],
        { rate: '1400', rateDate: new Date() },
      );
      expect(out.summaryText).toContain('• 자산: 140만원');
    });
    it('잔고가 오래됐으면 자산 줄을 생략한다', async () => {
      const out = await runWith([
        {
          ...holding,
          holdingDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      ]);
      expect(out.summaryText).not.toContain('• 자산:');
    });
    it('환율이 오래된 달러 보유는 자산 줄을 생략한다', async () => {
      const out = await runWith([{ ...holding, currency: 'USD' }], {
        rate: '1400',
        rateDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      });
      expect(out.summaryText).not.toContain('• 자산:');
    });
  });

  describe('마감 줄', () => {
    const planOutcome = {
      result: {
        plan: basePlan,
        sources: [],
        waitingItems: [],
        inputTruncation: NO_TRUNCATION,
      },
      modelUsed: 'codex-cli',
      agentRunId: 10,
    };
    const humanized = {
      humanize: jest
        .fn()
        .mockResolvedValue({ reasoning: '테스트 계획', analysisReasoning: '' }),
    };
    const dueSoon: ScheduleItemRecord = {
      ...buildScheduleItemRecord(),
      id: 1,
      slackUserId: 'U1',
      title: '자동차세',
      dueDate: new Date('2026-06-17T00:00:00.000Z'),
      dueTime: null,
      linkUrl: null,
      memo: null,
      status: ScheduleStatus.OPEN,
      completedAt: null,
      isHoliday: false,
    };

    // 정상 경로. summaryText 를 만드는 두 지점 중 하나다.
    it('PM 계획이 성공해도 마감을 덧붙인다', async () => {
      const task = buildTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        { execute: jest.fn().mockResolvedValue([dueSoon]) } as never,
      );

      const out = await task.run(CTX);

      expect(out.summaryText).toContain('*오늘 일정*\n• 자동차세 (오늘)');
    });

    it('7일 안의 열린 마감은 다가오는 마감에, 오늘과 지난 마감은 오늘 일정에 싣는다', async () => {
      const task = buildTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        {
          execute: jest.fn().mockResolvedValue([
            dueSoon,
            {
              ...dueSoon,
              id: 2,
              title: '이력서 제출',
              dueDate: new Date('2026-06-20T00:00:00.000Z'),
            },
            {
              ...dueSoon,
              id: 3,
              title: '닫힌 마감',
              dueDate: new Date('2026-06-20T00:00:00.000Z'),
              status: ScheduleStatus.DONE,
            },
            {
              ...dueSoon,
              id: 4,
              title: '공휴일',
              dueDate: new Date('2026-06-20T00:00:00.000Z'),
              isHoliday: true,
            },
          ]),
        } as never,
      );

      const out = await task.run(CTX);

      expect(out.summaryText).toContain('*오늘 일정*\n• 자동차세 (오늘)');
      expect(out.summaryText).toContain(
        '*다가오는 마감*\n• 6/20(토) 이력서 제출 (D-3)',
      );
      expect(out.summaryText).not.toContain('닫힌 마감');
      expect(out.summaryText).not.toContain('공휴일');
    });

    // 기한이 지난 미완 마감. 조회 하한을 오늘로 두던 동안 이 값은 **조회 자체에서 빠져**
    // 포맷터의 `D+n` 분기가 프로덕션에서 도달 불가였다(포맷터 단위 테스트만 초록이었다).
    const overdue: ScheduleItemRecord = {
      ...dueSoon,
      id: 2,
      title: '지난 자동차세',
      dueDate: new Date('2026-06-14T00:00:00.000Z'),
    };

    it('기한이 지난 미완 마감도 며칠 지났는지 싣는다', async () => {
      const task = buildTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        { execute: jest.fn().mockResolvedValue([overdue]) } as never,
      );

      const out = await task.run(CTX);

      expect(out.summaryText).toContain('• 지난 자동차세 (3일 지남)');
    });

    // 위 테스트는 포맷터에 값이 닿기만 하면 통과한다 — 목이 무엇을 내놓든 통과하므로
    // 정작 막혀 있던 **조회 범위**는 그것만으로 고정되지 않는다. 하한을 안 건다는 것을
    // 호출 인자로 직접 못 박는다: 어떤 하한이든 되살아나면 그 경계 밖 미완 마감이 다시
    // 조용히 사라지고, 그때 위 테스트는 여전히 초록이다.
    it('조회에 하한(from)을 걸지 않는다 — 지난 마감이 범위에서 빠지지 않게', async () => {
      const execute = jest.fn().mockResolvedValue([]);
      const task = buildTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        { execute } as never,
      );

      await task.run(CTX);

      const queried = execute.mock.calls[0][0] as ListSchedulesInput;
      expect(queried.from).toBeUndefined();
      expect(queried.to).toEqual(new Date('2026-06-24T00:00:00.000Z'));
    });

    // 이 태스크의 최대 함정 — catch(EMPTY_TASKS_INPUT) 경로에서 빠뜨리면
    // 할 일이 없는 날에 마감이 통째로 사라진다. 그날이야말로 마감 알림이 가장 필요한 날이다.
    it('할 일이 없는 날에도 마감을 덧붙인다', async () => {
      const execute = jest.fn().mockRejectedValue(
        new PmAgentException({
          code: PmAgentErrorCode.EMPTY_TASKS_INPUT,
          message: '수집된 할 일 없음',
          status: DomainStatus.UNPROCESSABLE_ENTITY,
        }),
      );
      const task = buildTask(
        { execute } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        { execute: jest.fn().mockResolvedValue([dueSoon]) } as never,
      );

      const out = await task.run(CTX);

      expect(out.summaryText).toContain('• 오늘 할 일이 없어요');
      expect(out.summaryText).toContain('*오늘 일정*\n• 자동차세 (오늘)');
    });

    it('항목이 없으면 마감 줄을 넣지 않는다', async () => {
      const task = buildTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        listSchedulesUsecase(),
      );

      const out = await task.run(CTX);

      expect(out.summaryText).not.toContain('*오늘 일정*');
    });

    it('기한 없는 진행 줄 없이 만료 전 후보 수만 브리핑에 싣는다', async () => {
      const schedules = {
        execute: jest.fn().mockResolvedValue([dueSoon]),
        undated: jest.fn().mockResolvedValue([
          {
            ...dueSoon,
            title: '기한 없는 진행',
            dueDate: null,
            status: ScheduleStatus.IN_PROGRESS,
          },
        ]),
        countActiveCandidates: jest.fn().mockResolvedValue(2),
      };
      const task = buildTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        schedules as never,
      );
      const result = await task.run(CTX);
      expect(result.summaryText).not.toContain('진행 중 1건');
      expect(result.summaryText).not.toContain('기한 없는 진행');
      expect(result.summaryText).toContain('새 후보 2건');
      expect(schedules.undated).not.toHaveBeenCalled();
    });

    it('기한 없는 조회를 하지 않고 후보 수는 보여준다', async () => {
      const schedules = {
        execute: jest.fn().mockResolvedValue([]),
        undated: jest.fn().mockRejectedValue(new Error('조회 실패')),
        countActiveCandidates: jest.fn().mockResolvedValue(2),
      };
      const task = buildTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        schedules as never,
      );
      expect((await task.run(CTX)).summaryText).toContain('새 후보 2건');
      expect(schedules.undated).not.toHaveBeenCalled();
    });
    it('후보 집계가 실패해도 브리핑을 보낸다', async () => {
      const schedules = {
        execute: jest.fn().mockResolvedValue([]),
        undated: jest.fn().mockResolvedValue([
          {
            ...dueSoon,
            title: '진행 업무',
            dueDate: null,
            status: ScheduleStatus.IN_PROGRESS,
          },
        ]),
        countActiveCandidates: jest
          .fn()
          .mockRejectedValue(new Error('집계 실패')),
      };
      const task = buildTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        schedules as never,
      );
      expect((await task.run(CTX)).summaryText).toContain('*오늘 할 일*');
    });

    // 장식 쿼리 하나가 본체를 죽이면 안 된다 — appendPortfolioValue 와 같은 원칙.
    it('마감 조회가 실패해도 브리핑 본문은 그대로 나간다', async () => {
      const task = buildTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        {
          execute: jest.fn().mockRejectedValue(new Error('DB 끊김')),
        } as never,
      );

      const out = await task.run(CTX);

      expect(out.skip).toBe(false);
      expect(out.summaryText).not.toContain('*오늘 일정*');
      expect(out.summaryText).toContain('*오늘 할 일*');
    });
  });
});

describe('MorningBriefingAutopilotTask — 아침 한 통', () => {
  const planOutcome = {
    result: {
      plan: {
        ...basePlan,
        topPriority: {
          ...mockTask,
          title: '비속어 필터 검증 근거 기록',
          url: 'https://github.com/o/r/pull/3668',
        },
      },
      sources: [],
      waitingItems: [],
      inputTruncation: NO_TRUNCATION,
    },
    modelUsed: 'codex-cli',
    agentRunId: 10,
  };
  const generateDailyPlan = () => ({
    execute: jest.fn().mockResolvedValue(planOutcome),
  });
  const humanize = () => ({
    humanize: jest
      .fn()
      .mockResolvedValue({ reasoning: '', analysisReasoning: '' }),
  });
  const posting = (company: string, key: string) => ({
    id: 1,
    source: 'jumpit',
    sourceId: key,
    company,
    title: '백엔드 개발자',
    normalizedKey: key,
    detailUrl: `https://jumpit.example/${key}`,
    skillTags: ['NestJS'],
    locations: ['서울'],
    minYears: 3,
    maxYears: 7,
    matchScore: 92,
  });
  const preview = (kind: string, slackUserId = 'U1') => ({
    kind,
    slackUserId,
    previewText: '*카드*',
  });

  it('할 일·장애·일정·그 밖에 순서로 한 통을 싣는다', async () => {
    const digestRepository = {
      ...emptyDigestRepository(),
      findOpenIncidents: jest.fn().mockResolvedValue([
        {
          label: 'Autopilot task paper-recommend',
          // 24시간 전은 KST 달력으로 언제나 어제다 → 2일째.
          openedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      ]),
      findLatestStudyBrief: jest.fn().mockResolvedValue({
        topic: 'Agent Middleware Hooks',
        notionUrl: 'https://notion.so/brief',
      }),
      findLatestConsoleText: jest
        .fn()
        .mockResolvedValue(
          '📁 *포트폴리오 사이트 발행*\n• 새 프로젝트 1건\n• 📋 이력서 감사 — 약함 2건\n\n신규: 긴 상세',
        ),
      countDuePaperOrders: jest
        .fn()
        .mockResolvedValue({ buyCount: 1, sellCount: 3 }),
    };
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        config: { JOB_FEED_ENABLED: 'true' },
        findAllOpenPreviews: {
          execute: jest.fn().mockResolvedValue([
            preview('EVENING_BLOG_PUBLISH'),
            preview('EVENING_CAREER_REFLECT'),
            preview('BLOG_GITHUB_PUBLISH'),
            // 남의 카드는 owner 가 처리할 수 없어 할 일이 아니다.
            preview('EVENING_BLOG_PUBLISH', 'U2'),
          ]),
        },
        listNotifiable: {
          execute: jest.fn().mockResolvedValue([posting('하마랩', 'hama')]),
        },
        digestRepository,
      },
    );

    const out = await task.run(CTX);

    expect(out.summaryText).toBe(
      [
        '☀️ *6/17(수) 아침* · 🔴 장애: 모의투자 추천 실패 · ✋ 승인 3 · 공고 1',
        '',
        '*오늘 할 일*',
        '• 오늘 할 일이 없어요',
        '',
        '*어제 장애*',
        '• 모의투자 추천 실패 (2일째)',
        '',
        '*그 밖에*',
        '• 승인 대기 3장 (블로그 후보 · 경력 반영 · GitHub 발행)',
        '• 투자: 오늘 시가 매수 1, 매도 3 예정',
        '• 새 공고 1건 (하마랩), 목록은 댓글에',
        '• 공부: <https://notion.so/brief|Agent Middleware Hooks> 15분',
        '• 포트폴리오: 어제 발행 · 새 프로젝트 1건 · 이력서 감사: 약함 2건',
      ].join('\n'),
    );
    // 공고 목록만 스레드에 있다.
    expect(out.detailText).not.toContain('*오늘의 최우선 과제*');
    expect(out.detailText).toContain('*새 백엔드 공고 1건*');
    expect(out.detailText).toContain('https://jumpit.example/hama');
    expect(out.summaryText).not.toContain('내 자산');
    expect(out.detailText).not.toContain('내 자산');
    expect(out.unfurlLinks).toBe(false);
    expect(digestRepository.findLatestConsoleText).toHaveBeenCalledWith(
      expect.objectContaining({ itemKind: 'portfolio-publish' }),
    );
  });

  it('승인·공고가 없어도 오늘 할 일은 첫 칸에 있고 선점 후처리는 없다', async () => {
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        config: { JOB_FEED_ENABLED: 'true' },
        buildMorningTodos: {
          execute: jest.fn().mockResolvedValue({
            loadFailed: false,
            today: [
              {
                title: '비속어 필터 검증 근거 기록',
                url: 'https://github.com/o/r/pull/3668',
                dayCount: 1,
                detail: null,
              },
            ],
            waiting: [],
            unstarted: [],
          }),
        },
      },
    );

    const out = await task.run(CTX);

    expect(out.summaryText?.split('\n')[0]).toBe('☀️ *6/17(수) 아침*');
    expect(out.summaryText).toContain(
      '*오늘 할 일*\n• <https://github.com/o/r/pull/3668|비속어 필터 검증 근거 기록>',
    );
    expect(out.onDelivered).toBeUndefined();
  });

  it('공고 선점은 발송 뒤 onDelivered 에서만, 한 건이 실패해도 나머지를 계속한다', async () => {
    const claimForNotification = jest
      .fn()
      .mockRejectedValueOnce(new Error('db 끊김'))
      .mockResolvedValue(true);
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        config: { JOB_FEED_ENABLED: 'true' },
        listNotifiable: {
          execute: jest
            .fn()
            .mockResolvedValue([posting('A사', 'a'), posting('B사', 'b')]),
        },
        jobPostingRepository: {
          findLastCollectedAt: jest.fn().mockResolvedValue(new Date()),
          claimForNotification,
        },
      },
    );

    const out = await task.run(CTX);
    // run() 만으로는 아무것도 선점하지 않는다 — 07:00 job-feed 와 08:30 사이 목록이 비지 않게.
    expect(claimForNotification).not.toHaveBeenCalled();

    await expect(out.onDelivered?.()).resolves.toBeUndefined();
    expect(claimForNotification).toHaveBeenCalledTimes(2);
    expect(claimForNotification).toHaveBeenNthCalledWith(
      2,
      'b',
      expect.any(Date),
    );
  });

  it('공고 수집이 꺼져 있으면 조회하지 않고 공고 줄도 없다', async () => {
    const listNotifiable = { execute: jest.fn() };
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      { listNotifiable },
    );

    const out = await task.run(CTX);

    expect(listNotifiable.execute).not.toHaveBeenCalled();
    expect(out.summaryText).not.toContain('공고');
  });

  it('마지막 수집이 이틀을 넘기면 "새 공고 없음" 대신 수집 정지를 알린다', async () => {
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        config: { JOB_FEED_ENABLED: 'true' },
        jobPostingRepository: {
          findLastCollectedAt: jest
            .fn()
            .mockResolvedValue(new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)),
          claimForNotification: jest.fn(),
        },
      },
    );

    const out = await task.run(CTX);

    // 첫 줄만 보고 판단하는 메시지라 수집 정지는 할 일(장애)로 세어 첫 줄에 드러난다.
    expect(out.summaryText).toContain('아침* · 🔴 장애: 공고 수집 멈춤');
    expect(out.summaryText).toContain(
      '*어제 장애*\n• 공고 수집 멈춤, 마지막 수집',
    );
  });

  it('평일인데 수집된 적이 한 번도 없으면 0건이 아니라 수집 문제로 알린다', async () => {
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        config: { JOB_FEED_ENABLED: 'true' },
        jobPostingRepository: {
          findLastCollectedAt: jest.fn().mockResolvedValue(null),
          claimForNotification: jest.fn(),
        },
      },
    );

    const out = await task.run(CTX);

    expect(out.summaryText).toContain(
      '*어제 장애*\n• 공고 수집된 적 없음, 수집 설정 확인',
    );
    expect(out.summaryText).toContain('*오늘 할 일*');
  });

  it('링크 없는 저장소 제목·장애 라벨도 mrkdwn 으로 해석되지 않게 이스케이프한다', async () => {
    const generate = {
      execute: jest.fn().mockResolvedValue({
        ...planOutcome,
        result: {
          ...planOutcome.result,
          plan: {
            ...basePlan,
            topPriority: { ...mockTask, title: '<!channel> 확인 & 배포' },
          },
        },
      }),
    };
    const digestRepository = {
      ...emptyDigestRepository(),
      findOpenIncidents: jest
        .fn()
        .mockResolvedValue([{ label: 'task <x>', openedAt: new Date() }]),
    };
    const task = buildTask(
      generate,
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        digestRepository,
        buildMorningTodos: {
          execute: jest.fn().mockResolvedValue({
            loadFailed: false,
            today: [
              {
                title: '<!channel> 확인 & 배포',
                url: null,
                dayCount: 1,
                detail: null,
              },
            ],
            waiting: [],
            unstarted: [],
          }),
        },
      },
    );

    const out = await task.run(CTX);

    expect(out.summaryText).toContain(
      '*오늘 할 일*\n• &lt;!channel&gt; 확인 &amp; 배포',
    );
    expect(out.summaryText).toContain('• task &lt;x&gt; (1일째)');
  });

  it('직전 아침 이후 닫힌 사건을 해결 줄로 싣는다 — 아침이 전날보다 늦게 돌아도 틈이 없다', async () => {
    // 전날 아침 08:31 발송 → 오늘 09:02 실행. "지금 - 24시간"(어제 09:02)이면 08:31~09:02 해결이 빠진다.
    const previousMorning = new Date('2026-06-16T08:31:00+09:00');
    const findLatestDeliveryBefore = jest
      .fn()
      .mockResolvedValue(previousMorning);
    const digestRepository = {
      ...emptyDigestRepository(),
      findResolvedIncidentLabels: jest.fn().mockResolvedValue([]),
    };
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      { digestRepository, cujLedgerReader: { findLatestDeliveryBefore } },
    );

    await task.run(CTX);

    expect(findLatestDeliveryBefore).toHaveBeenCalledWith(
      'morning-briefing',
      expect.any(Date),
    );
    const { since } = digestRepository.findResolvedIncidentLabels.mock
      .calls[0][0] as { since: Date };
    // 원장은 조회 뒤에 쓰이므로 10분 당겨 겹친다.
    expect(since).toEqual(new Date('2026-06-16T08:21:00+09:00'));
  });

  it('직전 아침 기록이 없으면 24시간 전부터 해결 줄을 싣는다 — 해결 DM 대신이다', async () => {
    const digestRepository = {
      ...emptyDigestRepository(),
      findResolvedIncidentLabels: jest
        .fn()
        .mockResolvedValue([
          'Autopilot task blog-github-publish',
          'Study Brief Cron',
        ]),
    };
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      { digestRepository },
    );

    const out = await task.run(CTX);

    // 해결 줄에서는 "… 실패" 를 뗀다 — "해결 — 블로그 GitHub 발행 실패" 로 읽히지 않게.
    expect(out.summaryText).toContain(
      '• 블로그 GitHub 발행, 지금은 복구됨\n• Study Brief Cron, 지금은 복구됨',
    );
    const { since } = digestRepository.findResolvedIncidentLabels.mock
      .calls[0][0] as { since: Date };
    expect(Date.now() - since.getTime()).toBeGreaterThanOrEqual(
      24 * 60 * 60 * 1000,
    );
  });

  it('이름표가 없는 Autopilot task 는 접두어만 떼고 task id 를 그대로 싣는다', async () => {
    const digestRepository = {
      ...emptyDigestRepository(),
      findOpenIncidents: jest
        .fn()
        .mockResolvedValue([
          { label: 'Autopilot task brand-new-task', openedAt: new Date() },
        ]),
    };
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      { digestRepository },
    );

    const out = await task.run(CTX);

    expect(out.summaryText).toContain('• brand-new-task 실패 (1일째)');
    expect(out.summaryText).not.toContain('Autopilot task');
  });

  it('주말 아침에는 수집 정지를 판정하지 않는다 — 수집은 평일만 돈다', async () => {
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        config: { JOB_FEED_ENABLED: 'true' },
        jobPostingRepository: {
          // 금요일 07:00 수집 → 일요일 08:30 은 49.5시간이다.
          findLastCollectedAt: jest
            .fn()
            .mockResolvedValue(new Date(Date.now() - 49.5 * 60 * 60 * 1000)),
          claimForNotification: jest.fn(),
        },
      },
    );

    const out = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-06-21',
    });

    expect(out.summaryText).not.toContain('공고 수집 멈춤');
  });

  it('공고명은 mrkdwn 으로 해석되지 않게 이스케이프한다', async () => {
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        config: { JOB_FEED_ENABLED: 'true' },
        listNotifiable: {
          execute: jest.fn().mockResolvedValue([posting('A&B<랩>', 'ab')]),
        },
      },
    );

    const out = await task.run(CTX);

    expect(out.summaryText).toContain(
      '새 공고 1건 (A&amp;B&lt;랩&gt;), 목록은 댓글에',
    );
    expect(out.detailText).not.toContain('*오늘의 최우선 과제*');
    expect(out.detailIsOnlyCopy).toBe(true);
  });

  it('PM 계획 생성이 실패해도 나머지 줄은 나가고 머리줄과 어제 장애에 실패를 알린다', async () => {
    const task = buildTask(
      {
        execute: jest
          .fn()
          .mockRejectedValue(new Error('codex quota token=sk-live-secret')),
      },
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        findAllOpenPreviews: {
          execute: jest
            .fn()
            .mockResolvedValue([preview('EVENING_CAREER_REFLECT')]),
        },
      },
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText?.split('\n')[0]).toBe(
      '☀️ *6/17(수) 아침* · 🔴 장애: 오늘 계획 생성 실패 · ✋ 승인 1',
    );
    expect(out.summaryText).toContain('*오늘 할 일*\n• 오늘 할 일이 없어요');
    expect(out.summaryText).toContain('• 승인 대기 1장 (경력 반영)');
    expect(out.summaryText).toContain('*어제 장애*\n• 오늘 계획 생성 실패');
    expect(out.summaryText).not.toContain('sk-live-secret');
    expect(out.detailText).toBe('');
  });

  it('포트폴리오 발행이 통째로 실패한 보고(불릿 없음)도 장애로 올린다', async () => {
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        digestRepository: {
          ...emptyDigestRepository(),
          findLatestConsoleText: jest
            .fn()
            .mockResolvedValue('⚠️ *포트폴리오 사이트 발행 실패* — 사이트 401'),
        },
      },
    );

    const out = await task.run(CTX);

    expect(out.summaryText).toContain(
      '*어제 장애*\n• 포트폴리오 사이트 발행 실패 (로그인이 만료된 것 같아요)',
    );
    expect(out.summaryText).not.toContain('• 포트폴리오: 어제');
  });

  it('포트폴리오 실패 사유를 구분자 상수로 읽는다', async () => {
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        digestRepository: {
          ...emptyDigestRepository(),
          findLatestConsoleText: jest
            .fn()
            .mockResolvedValue(
              '⚠️ *포트폴리오 사이트 발행 실패*: 사이트 API 401',
            ),
        },
      },
    );

    const out = await task.run(CTX);

    expect(out.summaryText).toContain(
      '• 포트폴리오 사이트 발행 실패 (로그인이 만료된 것 같아요)',
    );
    expect(out.summaryText).not.toContain('실패: :');
  });

  it('과거 원장의 줄표 구분자도 새 불릿 문구로 읽는다', async () => {
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        digestRepository: {
          ...emptyDigestRepository(),
          findLatestConsoleText: jest
            .fn()
            .mockResolvedValue(
              '📁 *포트폴리오 사이트 발행*\n• 📋 이력서 감사 — 약함 2건',
            ),
        },
      },
    );

    const out = await task.run(CTX);

    expect(out.summaryText).toContain('이력서 감사: 약함 2건');
    expect(out.summaryText).not.toContain('이력서 감사 —');
  });

  it('공부 브리프는 생산자(study-brief-cron)의 owner 키로 조회한다', async () => {
    const digestRepository = emptyDigestRepository();
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        digestRepository,
        config: { STUDY_BRIEF_OWNER_SLACK_USER_ID: 'U-STUDY' },
      },
    );

    await task.run(CTX);

    expect(digestRepository.findLatestStudyBrief).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: 'U-STUDY' }),
    );
  });

  it('곁다리 조회가 실패해도 그 줄만 빠지고 메시지는 나간다', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('db down'));
    const task = buildTask(
      generateDailyPlan(),
      humanize(),
      emptyStockRepository(),
      listSchedulesUsecase(),
      {
        findAllOpenPreviews: { execute: failing },
        digestRepository: {
          findOpenIncidents: failing,
          findLatestStudyBrief: failing,
          findLatestConsoleText: failing,
          countDuePaperOrders: failing,
        },
      },
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('*오늘 할 일*');
    expect(out.summaryText).toContain('• 오늘 할 일이 없어요');
  });
});
