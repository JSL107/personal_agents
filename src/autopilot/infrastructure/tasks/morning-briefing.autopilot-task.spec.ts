import { Prisma } from '@prisma/client';

import { GenerateDailyPlanUsecase } from '../../../agent/pm/application/generate-daily-plan.usecase';
import { PmAgentException } from '../../../agent/pm/domain/pm-agent.exception';
import { PmAgentErrorCode } from '../../../agent/pm/domain/pm-agent-error-code.enum';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { HumanizeService } from '../../../humanize/application/humanize.service';
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
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toBeTruthy();
    expect(out.summaryText).toContain('판단 근거');
    expect(out.detailText).not.toContain('판단 근거');
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
    );
    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-06-30',
    });
    expect(result.summaryText).toContain('대기 중');
    expect(result.summaryText).toContain('머지만 남음');
    expect(result.summaryText).toContain('판단 근거');
    expect(result.detailText).not.toContain('판단 근거');
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
      );

      const out = await task.run(CTX);

      expect(out.summaryText).not.toContain('내 자산');
    });
  });
});
