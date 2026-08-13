import { Logger } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConsoleAgentState, ConsoleSnapshot } from '../domain/console.type';
import { ConsoleReadService } from './console-read.service';
import { SuggestNextWorkUsecase } from './suggest-next-work.usecase';

const NOW = new Date('2026-08-13T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

interface AgentFixture {
  readonly agentType: AgentType;
  readonly displayName: string;
  readonly state?: ConsoleAgentState;
}

const makeSnapshot = (agents: readonly AgentFixture[]): ConsoleSnapshot => ({
  agents: agents.map((agent) => ({
    agentType: agent.agentType,
    displayName: agent.displayName,
    slashCommands: [],
    description: '',
    state: agent.state ?? ConsoleAgentState.WAITING,
    bubble: '',
    department: '',
    departmentLabel: '',
    job: '',
    lastFinishedRunId: null,
    doneToday: 0,
  })),
  runs: [],
  approvals: [],
  sessions: [],
  serverTime: NOW.toISOString(),
});

const succeededAt = (...daysAgo: number[]) =>
  daysAgo.map((day, index) => ({
    id: index + 1,
    output: {},
    endedAt: new Date(NOW.getTime() - day * DAY_MS),
  }));

const succeededAtInstants = (...instants: string[]) =>
  instants.map((instant, index) => ({
    id: index + 1,
    output: {},
    endedAt: new Date(instant),
  }));

const make = ({
  agents,
  runsByAgentType,
}: {
  agents: readonly AgentFixture[];
  runsByAgentType: Partial<Record<AgentType, ReturnType<typeof succeededAt>>>;
}) => {
  const consoleRead = {
    getSnapshot: jest.fn().mockResolvedValue(makeSnapshot(agents)),
  };
  const agentRunService = {
    findRecentSucceededRuns: jest.fn(
      ({ agentType, limit }: { agentType: AgentType; limit: number }) =>
        Promise.resolve((runsByAgentType[agentType] ?? []).slice(0, limit)),
    ),
  };
  const usecase = new SuggestNextWorkUsecase(
    consoleRead as unknown as ConsoleReadService,
    agentRunService as unknown as AgentRunService,
  );
  return { usecase, agentRunService };
};

describe('SuggestNextWorkUsecase', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('평소 주기로 정규화해 하루 주기 2일 지연을 주 1회 3일 경과보다 앞세운다', async () => {
    const { usecase } = make({
      agents: [
        { agentType: AgentType.PM, displayName: 'PM' },
        { agentType: AgentType.CODE_REVIEWER, displayName: 'Code Reviewer' },
      ],
      runsByAgentType: {
        [AgentType.PM]: succeededAt(2, 3, 4),
        [AgentType.CODE_REVIEWER]: succeededAt(3, 10, 17),
      },
    });

    const result = await usecase.execute();

    expect(
      result.suggestions.map((suggestion) => suggestion.agentType),
    ).toEqual([AgentType.PM]);
    expect(result.suggestions[0]?.reason).toBe(
      '마지막 성공 2일 전 · 평소 1일 주기',
    );
    expect(result.alsoDueCount).toBe(0);
  });

  it('같은 KST 날짜의 여러 성공을 한 날로 세어 주기를 계산한다', async () => {
    const { usecase } = make({
      agents: [{ agentType: AgentType.PM, displayName: 'PM' }],
      runsByAgentType: {
        [AgentType.PM]: succeededAtInstants(
          '2026-08-11T12:05:00.000Z',
          '2026-08-11T12:00:00.000Z',
          '2026-08-10T12:00:00.000Z',
          '2026-08-09T12:00:00.000Z',
        ),
      },
    });

    const result = await usecase.execute();

    expect(result.suggestions).toEqual([
      {
        agentType: AgentType.PM,
        displayName: 'PM',
        reason: '마지막 성공 2일 전 · 평소 1일 주기',
      },
    ]);
    expect(result.skippedUnknownCycle).toBe(0);
  });

  it('같은 날짜 성공이 조회 상한 가까이 몰려도 이전 날짜 표본으로 주기를 계산한다', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const denseRuns = Array.from({ length: 297 }, (_, index) => ({
      id: index + 1,
      output: {},
      endedAt: new Date(NOW.getTime() - 2 * DAY_MS),
    }));
    const { usecase } = make({
      agents: [
        { agentType: AgentType.CODE_REVIEWER, displayName: 'Code Reviewer' },
      ],
      runsByAgentType: {
        [AgentType.CODE_REVIEWER]: [...denseRuns, ...succeededAt(3, 4, 5)],
      },
    });

    try {
      const result = await usecase.execute();

      expect(result.suggestions[0]?.reason).toBe(
        '마지막 성공 2일 전 · 평소 1일 주기',
      );
      expect(result.skippedUnknownCycle).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        '콘솔 할 일 제안 원장 표본 부족 — CODE_REVIEWER: 성공 run 300/300건, 서로 다른 성공일 4개',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('성공일 4개의 간격 1일·5일·2일을 정렬해 중위 2일 주기로 계산한다', async () => {
    const { usecase } = make({
      agents: [{ agentType: AgentType.PM, displayName: 'PM' }],
      runsByAgentType: {
        [AgentType.PM]: succeededAt(2, 3, 8, 10),
      },
    });

    const result = await usecase.execute();

    expect(result.suggestions[0]?.reason).toBe(
      '마지막 성공 2일 전 · 평소 2일 주기',
    );
  });

  it('오늘 연속 성공만 있는 PAPER_RECOMMEND는 주기 미상으로 제외한다', async () => {
    const { usecase } = make({
      agents: [
        {
          agentType: AgentType.PAPER_RECOMMEND,
          displayName: 'Paper Recommend',
        },
      ],
      runsByAgentType: {
        [AgentType.PAPER_RECOMMEND]: succeededAtInstants(
          '2026-08-13T10:05:00.000Z',
          '2026-08-13T10:00:00.000Z',
        ),
      },
    });

    const result = await usecase.execute();

    expect(result).toEqual({
      suggestions: [],
      skippedUnknownCycle: 1,
      alsoDueCount: 0,
    });
  });

  it('UTC 날짜가 같아도 KST 00:30 성공은 새 KST 날짜로 센다', async () => {
    const { usecase } = make({
      agents: [{ agentType: AgentType.PM, displayName: 'PM' }],
      runsByAgentType: {
        [AgentType.PM]: succeededAtInstants(
          '2026-08-11T15:30:00.000Z',
          '2026-08-11T14:30:00.000Z',
        ),
      },
    });

    const result = await usecase.execute();

    expect(result.suggestions[0]?.reason).toBe(
      '마지막 성공 1일 전 · 평소 1일 주기',
    );
    expect(result.skippedUnknownCycle).toBe(0);
  });

  it('둘 다 주기를 넘겼어도 절대 경과가 아닌 지연률 내림차순으로 정렬한다', async () => {
    const { usecase } = make({
      agents: [
        { agentType: AgentType.PM, displayName: 'PM' },
        { agentType: AgentType.CODE_REVIEWER, displayName: 'Code Reviewer' },
      ],
      runsByAgentType: {
        [AgentType.PM]: succeededAt(2, 3, 4),
        [AgentType.CODE_REVIEWER]: succeededAt(8, 15, 22),
      },
    });

    const result = await usecase.execute();

    expect(
      result.suggestions.map((suggestion) => suggestion.agentType),
    ).toEqual([AgentType.PM, AgentType.CODE_REVIEWER]);
  });

  it('평소 주기보다 덜 경과한 worker는 제안하지 않는다', async () => {
    const { usecase } = make({
      agents: [{ agentType: AgentType.PM, displayName: 'PM' }],
      runsByAgentType: { [AgentType.PM]: succeededAt(2, 5, 8) },
    });

    const result = await usecase.execute();

    expect(result.suggestions).toEqual([]);
  });

  it('성공 기록 1건 worker를 제외하고 skippedUnknownCycle에 센다', async () => {
    const { usecase } = make({
      agents: [{ agentType: AgentType.PM, displayName: 'PM' }],
      runsByAgentType: { [AgentType.PM]: succeededAt(2) },
    });

    const result = await usecase.execute();

    expect(result).toEqual({
      suggestions: [],
      skippedUnknownCycle: 1,
      alsoDueCount: 0,
    });
  });

  it('지연 후보가 5개여도 지연률 상위 3개만 반환한다', async () => {
    const agentTypes = [
      AgentType.PM,
      AgentType.BE,
      AgentType.CODE_REVIEWER,
      AgentType.WORK_REVIEWER,
      AgentType.IMPACT_REPORTER,
    ];
    const { usecase } = make({
      agents: agentTypes.map((agentType) => ({
        agentType,
        displayName: agentType,
      })),
      runsByAgentType: Object.fromEntries(
        agentTypes.map((agentType, index) => [
          agentType,
          succeededAt(6 - index, 7 - index),
        ]),
      ),
    });

    const result = await usecase.execute();

    expect(result.suggestions).toHaveLength(3);
    expect(
      result.suggestions.map((suggestion) => suggestion.agentType),
    ).toEqual([AgentType.PM, AgentType.BE, AgentType.CODE_REVIEWER]);
    expect(result.alsoDueCount).toBe(2);
  });

  it('IN_PROGRESS와 AWAITING_APPROVAL worker는 원장 조회 후보에서도 제외한다', async () => {
    const { usecase, agentRunService } = make({
      agents: [
        {
          agentType: AgentType.PM,
          displayName: 'PM',
          state: ConsoleAgentState.IN_PROGRESS,
        },
        {
          agentType: AgentType.BE,
          displayName: 'Backend',
          state: ConsoleAgentState.AWAITING_APPROVAL,
        },
        { agentType: AgentType.CODE_REVIEWER, displayName: 'Code Reviewer' },
      ],
      runsByAgentType: {
        [AgentType.PM]: succeededAt(2, 3),
        [AgentType.BE]: succeededAt(2, 3),
        [AgentType.CODE_REVIEWER]: succeededAt(2, 3),
      },
    });

    await usecase.execute();

    expect(agentRunService.findRecentSucceededRuns).toHaveBeenCalledTimes(1);
    expect(agentRunService.findRecentSucceededRuns).toHaveBeenCalledWith({
      agentType: AgentType.CODE_REVIEWER,
      sinceDays: 60,
      limit: 300,
    });
  });
});
