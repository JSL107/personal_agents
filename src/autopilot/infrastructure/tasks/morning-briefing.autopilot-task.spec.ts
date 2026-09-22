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
import { MorningBriefingAutopilotTask } from './morning-briefing.autopilot-task';

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
  it('id 는 morning-briefing', () => {
    const humanizeService = { humanize: jest.fn() };
    const task = new MorningBriefingAutopilotTask(
      {} as never,
      humanizeService as unknown as HumanizeService,
      emptyStockRepository(),
      listSchedulesUsecase(),
    );
    expect(task.id).toBe('morning-briefing');
  });

  it('PM 계획 성공 시 summaryText 반환(skip=false)', async () => {
    const execute = jest.fn().mockResolvedValue({
      result: {
        plan: basePlan,
        sources: [],
        waitingItems: [],
      },
      modelUsed: 'codex-cli',
      agentRunId: 10,
    });
    const humanizeService = {
      humanize: jest
        .fn()
        .mockResolvedValue({ reasoning: '테스트 계획', analysisReasoning: '' }),
    };
    const task = new MorningBriefingAutopilotTask(
      { execute } as never,
      humanizeService as unknown as HumanizeService,
      emptyStockRepository(),
      listSchedulesUsecase(),
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toBeTruthy();
    // 판단 근거는 스레드로 내려간다. 메인에는 무엇이 스레드에 있는지 알리는 줄만 남는다.
    expect(out.summaryText).not.toContain('*판단 근거*');
    expect(out.summaryText).toContain('👇 판단 근거');
    expect(out.detailText).toContain('*판단 근거*');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1', tasksText: '' }),
    );
  });

  it('plan 을 윤문하고 대기 섹션을 summaryText 에 합성한다', async () => {
    const outcome = {
      result: {
        plan: basePlan,
        sources: [],
        waitingItems: [
          { title: 'PR1', url: 'https://x/1', reason: '머지만 남음' },
        ],
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
    const task = new MorningBriefingAutopilotTask(
      generateDailyPlan as unknown as GenerateDailyPlanUsecase,
      humanizeService as unknown as HumanizeService,
      emptyStockRepository(),
      listSchedulesUsecase(),
    );
    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-06-30',
    });
    expect(result.summaryText).toContain('대기 중');
    expect(result.summaryText).toContain('머지만 남음');
    // 윤문된 판단 근거·이월도 스레드로 간다 — 메인에는 안내 줄만 남는다.
    expect(result.summaryText).not.toContain('*판단 근거*');
    expect(result.detailText).toContain('*판단 근거*');
    expect(result.detailText).toContain('*어제 이월*');
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
    const task = new MorningBriefingAutopilotTask(
      { execute } as never,
      humanizeService as unknown as HumanizeService,
      emptyStockRepository(),
      listSchedulesUsecase(),
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('오늘 자동 수집된 할 일이 없습니다');
  });

  it('그 외 에러는 throw', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    const humanizeService = { humanize: jest.fn() };
    const task = new MorningBriefingAutopilotTask(
      { execute } as never,
      humanizeService as unknown as HumanizeService,
      emptyStockRepository(),
      listSchedulesUsecase(),
    );
    await expect(task.run(CTX)).rejects.toThrow('boom');
  });

  describe('자산 한 줄', () => {
    const planOutcome = {
      result: { plan: basePlan, sources: [], waitingItems: [] },
      modelUsed: 'codex-cli',
      agentRunId: 10,
    };
    const humanized = {
      humanize: jest
        .fn()
        .mockResolvedValue({ reasoning: '테스트 계획', analysisReasoning: '' }),
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

    it('보유가 있으면 브리핑 끝에 자산 줄을 붙인다', async () => {
      const task = new MorningBriefingAutopilotTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        {
          findPortfolioPositions: jest.fn().mockResolvedValue([holding]),
          findLatestFxRate: jest.fn().mockResolvedValue(null),
        } as never,
        listSchedulesUsecase(),
      );

      const out = await task.run(CTX);

      expect(out.summaryText).toContain('내 자산');
      expect(out.summaryText).toContain('매입가 대비');
    });

    // 장식 쿼리 하나가 본체를 죽이면 안 된다.
    it('자산 조회가 실패해도 브리핑 본문은 그대로 나간다', async () => {
      const task = new MorningBriefingAutopilotTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        {
          findPortfolioPositions: jest
            .fn()
            .mockRejectedValue(new Error('DB 끊김')),
          findLatestFxRate: jest.fn(),
        } as never,
        listSchedulesUsecase(),
      );

      const out = await task.run(CTX);

      expect(out.skip).toBe(false);
      expect(out.summaryText).not.toContain('내 자산');
      expect(out.summaryText?.length).toBeGreaterThan(0);
    });

    // 이 목표가 겨냥한 것이 정확히 "아무 일 없는 날" 이다.
    it('할 일이 없는 날에도 자산은 말해 준다', async () => {
      const execute = jest.fn().mockRejectedValue(
        new PmAgentException({
          code: PmAgentErrorCode.EMPTY_TASKS_INPUT,
          message: '수집된 할 일 없음',
          status: DomainStatus.UNPROCESSABLE_ENTITY,
        }),
      );
      const task = new MorningBriefingAutopilotTask(
        { execute } as never,
        humanized as unknown as HumanizeService,
        {
          findPortfolioPositions: jest.fn().mockResolvedValue([holding]),
          findLatestFxRate: jest.fn().mockResolvedValue(null),
        } as never,
        listSchedulesUsecase(),
      );

      const out = await task.run(CTX);

      expect(out.summaryText).toContain('자동 수집된 할 일이 없습니다');
      expect(out.summaryText).toContain('내 자산');
    });

    // 환율을 실제로 읽어 쓰는 경로다. 파싱·전달·출력 연결이 여기서만 한 번에 확인된다.
    it('최근 환율이 있으면 달러 보유를 환산해 자산 줄을 낸다', async () => {
      const task = new MorningBriefingAutopilotTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        {
          findPortfolioPositions: jest.fn().mockResolvedValue([
            {
              ...holding,
              currency: 'USD',
              quantity: new Prisma.Decimal('100'),
              close: new Prisma.Decimal('10'),
              avgPrice: new Prisma.Decimal('8'),
              previousClose: new Prisma.Decimal('9'),
            },
          ]),
          findLatestFxRate: jest
            .fn()
            .mockResolvedValue({ rate: '1400', rateDate: new Date() }),
        } as never,
        listSchedulesUsecase(),
      );

      const out = await task.run(CTX);

      // 100주 x $10 x 1,400 = 1,400,000원. 환율이 실제로 곱해졌는지 값으로 확인한다
      // (환율을 안 쓰면 1,000원이라 만원 단위 표기 자체가 나오지 않는다).
      expect(out.summaryText).toContain('140만원');
      expect(out.summaryText).toContain('매입가 대비');
    });

    // 동기화가 멈춘 채 며칠 지나면 수량 자체가 옛것이다. 평가액은 계산되지만 지금 자산이 아니다.
    it('잔고가 오래됐으면 자산 줄을 내지 않는다', async () => {
      const stale = new Date();
      stale.setDate(stale.getDate() - 30);
      const task = new MorningBriefingAutopilotTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        {
          findPortfolioPositions: jest
            .fn()
            .mockResolvedValue([{ ...holding, holdingDate: stale }]),
          findLatestFxRate: jest.fn().mockResolvedValue(null),
        } as never,
        listSchedulesUsecase(),
      );

      const out = await task.run(CTX);

      expect(out.summaryText).not.toContain('내 자산');
    });

    // 환율이 오래되면 환산이 자산 규모를 왜곡한다. 달러 보유가 있으면 줄을 통째로 뺀다.
    it('환율이 오래됐으면 달러 보유가 있는 자산 줄을 내지 않는다', async () => {
      const stale = new Date();
      stale.setDate(stale.getDate() - 30);
      const task = new MorningBriefingAutopilotTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        {
          findPortfolioPositions: jest
            .fn()
            .mockResolvedValue([{ ...holding, currency: 'USD' }]),
          findLatestFxRate: jest
            .fn()
            .mockResolvedValue({ rate: '1400', rateDate: stale }),
        } as never,
        listSchedulesUsecase(),
      );

      const out = await task.run(CTX);

      expect(out.summaryText).not.toContain('내 자산');
    });
  });

  describe('마감 줄', () => {
    const planOutcome = {
      result: { plan: basePlan, sources: [], waitingItems: [] },
      modelUsed: 'codex-cli',
      agentRunId: 10,
    };
    const humanized = {
      humanize: jest
        .fn()
        .mockResolvedValue({ reasoning: '테스트 계획', analysisReasoning: '' }),
    };
    const dueSoon: ScheduleItemRecord = {
      id: 1,
      slackUserId: 'U1',
      title: '자동차세',
      dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      dueTime: null,
      linkUrl: null,
      memo: null,
      status: ScheduleStatus.OPEN,
      completedAt: null,
    };

    // 정상 경로. summaryText 를 만드는 두 지점 중 하나다.
    it('PM 계획이 성공해도 마감을 덧붙인다', async () => {
      const task = new MorningBriefingAutopilotTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        { execute: jest.fn().mockResolvedValue([dueSoon]) } as never,
      );

      const out = await task.run(CTX);

      expect(out.summaryText).toContain('📌 마감 —');
      expect(out.summaryText).toContain('자동차세');
    });

    // 기한이 지난 미완 마감. 조회 하한을 오늘로 두던 동안 이 값은 **조회 자체에서 빠져**
    // 포맷터의 `D+n` 분기가 프로덕션에서 도달 불가였다(포맷터 단위 테스트만 초록이었다).
    const overdue: ScheduleItemRecord = {
      ...dueSoon,
      id: 2,
      title: '지난 자동차세',
      dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    };

    it('기한이 지난 미완 마감도 브리핑에 D+n 으로 싣는다', async () => {
      const task = new MorningBriefingAutopilotTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        { execute: jest.fn().mockResolvedValue([overdue]) } as never,
      );

      const out = await task.run(CTX);

      expect(out.summaryText).toContain('지난 자동차세');
      expect(out.summaryText).toMatch(/D\+\d+/);
    });

    // 위 테스트는 포맷터에 값이 닿기만 하면 통과한다 — 목이 무엇을 내놓든 통과하므로
    // 정작 막혀 있던 **조회 범위**는 그것만으로 고정되지 않는다. 하한을 안 건다는 것을
    // 호출 인자로 직접 못 박는다: 어떤 하한이든 되살아나면 그 경계 밖 미완 마감이 다시
    // 조용히 사라지고, 그때 위 테스트는 여전히 초록이다.
    it('조회에 하한(from)을 걸지 않는다 — 지난 마감이 범위에서 빠지지 않게', async () => {
      const execute = jest.fn().mockResolvedValue([]);
      const task = new MorningBriefingAutopilotTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        { execute } as never,
      );

      await task.run(CTX);

      const queried = execute.mock.calls[0][0] as ListSchedulesInput;
      expect(queried.from).toBeUndefined();
      // 상한은 그대로 오늘로부터 7일 뒤여야 한다. 하한을 떼면서 상한까지 흔들리면
      // 한 달 뒤 마감이 매일 아침 줄에 섞인다. 기준이 **KST 달력일의 UTC 자정** 이라
      // 지금 시각과는 최대 9시간 어긋나므로 6~7일 폭으로 받는다.
      const dayMs = 24 * 60 * 60 * 1000;
      const aheadDays = Math.round((queried.to.getTime() - Date.now()) / dayMs);
      expect(aheadDays).toBeGreaterThanOrEqual(6);
      expect(aheadDays).toBeLessThanOrEqual(7);
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
      const task = new MorningBriefingAutopilotTask(
        { execute } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        { execute: jest.fn().mockResolvedValue([dueSoon]) } as never,
      );

      const out = await task.run(CTX);

      expect(out.summaryText).toContain('자동 수집된 할 일이 없습니다');
      expect(out.summaryText).toContain('📌 마감 —');
      expect(out.summaryText).toContain('자동차세');
    });

    it('항목이 없으면 마감 줄을 넣지 않는다', async () => {
      const task = new MorningBriefingAutopilotTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        listSchedulesUsecase(),
      );

      const out = await task.run(CTX);

      expect(out.summaryText).not.toContain('📌 마감 —');
    });

    // 장식 쿼리 하나가 본체를 죽이면 안 된다 — appendPortfolioValue 와 같은 원칙.
    it('마감 조회가 실패해도 브리핑 본문은 그대로 나간다', async () => {
      const task = new MorningBriefingAutopilotTask(
        { execute: jest.fn().mockResolvedValue(planOutcome) } as never,
        humanized as unknown as HumanizeService,
        emptyStockRepository(),
        {
          execute: jest.fn().mockRejectedValue(new Error('DB 끊김')),
        } as never,
      );

      const out = await task.run(CTX);

      expect(out.skip).toBe(false);
      expect(out.summaryText).not.toContain('📌 마감 —');
      expect(out.summaryText?.length).toBeGreaterThan(0);
    });
  });
});
