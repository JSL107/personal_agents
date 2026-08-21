import { PrismaService } from '../../prisma/prisma.service';
import { AgentRunStatus } from '../domain/agent-run.type';
import {
  AgentRunPrismaRepository,
  extractFailureReason,
} from './agent-run.prisma.repository';

describe('extractFailureReason', () => {
  it('output.error 문자열을 그대로 쓴다', () => {
    expect(
      extractFailureReason({ error: '모델 호출 실패 (CHATGPT, 362s 소요)' }),
    ).toBe('모델 호출 실패 (CHATGPT, 362s 소요)');
  });

  it('앞뒤 공백을 다듬는다', () => {
    expect(
      extractFailureReason({ error: '  swept: stale IN_PROGRESS  ' }),
    ).toBe('swept: stale IN_PROGRESS');
  });

  it.each([
    ['error 키 없음', { message: '다른 형태' }],
    ['error 가 빈 문자열', { error: '   ' }],
    ['error 가 문자열이 아님', { error: { nested: true } }],
    ['output 이 null', null],
    ['output 이 객체가 아님', '문자열 output'],
  ])('%s 이면 고정 문구로 대체한다', (_label, output) => {
    // 비서실 브리핑의 "막힌 이유" 칸이 빈 채로 나가지 않게 한다.
    expect(extractFailureReason(output)).toBe('이유 미기록');
  });
});

describe('AgentRunPrismaRepository.sweepZombies', () => {
  it('cutoff 이전 IN_PROGRESS 를 FAILED 로 updateMany 하고 count 반환', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-21T00:00:00.000Z'));
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const prismaMock = {
      agentRun: { updateMany },
    } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    const result = await repository.sweepZombies({ olderThanMinutes: 30 });

    expect(result).toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: 'IN_PROGRESS',
        startedAt: { lt: new Date('2026-07-20T23:30:00.000Z') },
      },
      data: {
        status: 'FAILED',
        output: { error: 'swept: stale IN_PROGRESS' },
        endedAt: new Date('2026-07-21T00:00:00.000Z'),
      },
    });
    jest.useRealTimers();
  });
});

describe('AgentRunPrismaRepository.findFailedRunsSince', () => {
  // slackUserId 는 agent_run 의 컬럼이 아니다. 스칼라로 얹으면 Prisma 가 런타임에
  // 거부하는데(2026-08-21 PO Shadow 실패) 스프레드로 넣으면 컴파일에서 안 잡혀
  // 통과했다 — where 형태를 단언해 같은 형태의 회귀를 막는다.
  const buildRepository = (): {
    repository: AgentRunPrismaRepository;
    findMany: jest.Mock;
  } => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prismaMock = { agentRun: { findMany } } as unknown as PrismaService;
    return {
      repository: new AgentRunPrismaRepository(prismaMock),
      findMany,
    };
  };

  it('slackUserId 를 inputSnapshot JSON path 로 매칭한다 (스칼라 컬럼 아님)', async () => {
    const { repository, findMany } = buildRepository();

    await repository.findFailedRunsSince({
      withinMinutes: 60,
      slackUserId: 'U1',
    });

    const where = findMany.mock.calls[0][0].where;
    expect(where.inputSnapshot).toEqual({
      path: ['slackUserId'],
      equals: 'U1',
    });
    expect(where.slackUserId).toBeUndefined();
  });

  it('빈 문자열도 JSON 경로로 매칭한다 — 사용자 한정이 사라지지 않게', async () => {
    // truthy 검사면 여기서 필터가 통째로 빠져 남의 실패까지 반환된다(fail-open).
    const { repository, findMany } = buildRepository();

    await repository.findFailedRunsSince({
      withinMinutes: 60,
      slackUserId: '',
    });

    const where = findMany.mock.calls[0][0].where;
    expect(where.inputSnapshot).toEqual({ path: ['slackUserId'], equals: '' });
  });

  it('slackUserId 미지정이면 사용자 필터를 걸지 않는다', async () => {
    const { repository, findMany } = buildRepository();

    await repository.findFailedRunsSince({ withinMinutes: 60 });

    const where = findMany.mock.calls[0][0].where;
    expect(where.inputSnapshot).toBeUndefined();
    expect(where.status).toBe(AgentRunStatus.FAILED);
  });
});

describe('AgentRunPrismaRepository Ops Supervisor 집계', () => {
  it('aggregateRetryCounts: FAILURE_REPLAY 트리거를 agentType 별로 센다', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValue([{ agentType: 'PM', _count: { _all: 2 } }]);
    const prismaMock = { agentRun: { groupBy } } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    const result = await repository.aggregateRetryCounts({ sinceDays: 30 });

    expect(result).toEqual([{ agentType: 'PM', retries: 2 }]);
    expect(groupBy.mock.calls[0][0].where.triggerType).toBe('FAILURE_REPLAY');
  });

  it('aggregateSweptCounts: swept 마커가 붙은 FAILED 를 센다', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValue([{ agentType: 'BE', _count: { _all: 1 } }]);
    const prismaMock = { agentRun: { groupBy } } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    const result = await repository.aggregateSweptCounts({ sinceDays: 30 });

    expect(result).toEqual([{ agentType: 'BE', swept: 1 }]);
    const where = groupBy.mock.calls[0][0].where;
    expect(where.status).toBe('FAILED');
    expect(where.output).toEqual({
      path: ['error'],
      string_starts_with: 'swept:',
    });
  });
});

// V3 비전 봇 쪼개기 step 8 (commit 2c236d7) 의 updateParentId 단위 검증.
// repository 의 다른 method 들은 다른 의존성 (raw SQL / aggregate / FTS) 이 많아 spec 분리 가치 낮음 —
// updateParentId 는 단순 update 라 mock 으로 명확히 검증 가능.
describe('AgentRunPrismaRepository.updateParentId', () => {
  const buildRepository = (): {
    repo: AgentRunPrismaRepository;
    update: jest.Mock;
  } => {
    const update = jest.fn().mockResolvedValue(undefined);
    const prismaMock = {
      agentRun: { update },
    } as unknown as PrismaService;
    return { repo: new AgentRunPrismaRepository(prismaMock), update };
  };

  it('주어진 id 의 row 에 parentId 만 update — where/data 정확히 매핑', async () => {
    const { repo, update } = buildRepository();

    await repo.updateParentId({ id: 42, parentId: 7 });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { parentId: 7 },
    });
  });

  it('prisma update 가 reject 하면 그대로 propagate (manager 가 try/catch 로 graceful 처리)', async () => {
    const { repo, update } = buildRepository();
    const dbError = new Error('connection lost');
    update.mockRejectedValueOnce(dbError);

    await expect(repo.updateParentId({ id: 1, parentId: 2 })).rejects.toBe(
      dbError,
    );
  });
});

describe('AgentRunPrismaRepository.findActiveRuns', () => {
  it('객체 inputSnapshot만 보존하고 배열·스칼라·null은 null로 정규화한다', async () => {
    const startedAt = new Date('2026-08-12T00:00:00.000Z');
    const rows = [
      {
        id: 1,
        agentType: 'CODE_REVIEWER',
        status: AgentRunStatus.IN_PROGRESS,
        parentId: null,
        startedAt,
        endedAt: null,
        triggerType: 'PR_REVIEW_SWEEP',
        inputSnapshot: { pullNumber: 273 },
      },
      {
        id: 2,
        agentType: 'PM',
        status: AgentRunStatus.IN_PROGRESS,
        parentId: null,
        startedAt,
        endedAt: null,
        triggerType: 'SLACK_COMMAND_TODAY',
        inputSnapshot: [273],
      },
      {
        id: 3,
        agentType: 'BE',
        status: AgentRunStatus.IN_PROGRESS,
        parentId: 1,
        startedAt,
        endedAt: null,
        triggerType: 'SLACK_COMMAND_BE_FIX',
        inputSnapshot: 'scalar',
      },
      {
        id: 4,
        agentType: 'WORK_REVIEWER',
        status: AgentRunStatus.IN_PROGRESS,
        parentId: null,
        startedAt,
        endedAt: null,
        triggerType: 'DAILY_EVAL_CRON',
        inputSnapshot: null,
      },
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    const prismaMock = {
      agentRun: { findMany },
    } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    const result = await repository.findActiveRuns();

    expect(result.map((run) => run.inputSnapshot)).toEqual([
      { pullNumber: 273 },
      null,
      null,
      null,
    ]);
    expect(result.map((run) => run.triggerType)).toEqual([
      'PR_REVIEW_SWEEP',
      'SLACK_COMMAND_TODAY',
      'SLACK_COMMAND_BE_FIX',
      'DAILY_EVAL_CRON',
    ]);
  });
});

describe('AgentRunPrismaRepository.findRecentSucceededRuns', () => {
  const buildRepository = (): {
    repository: AgentRunPrismaRepository;
    findMany: jest.Mock;
  } => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prismaMock = {
      agentRun: { findMany },
    } as unknown as PrismaService;
    return { repository: new AgentRunPrismaRepository(prismaMock), findMany };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-07T16:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sinceDays=1 이면 오늘 KST 00:00 이상으로 조회한다', async () => {
    const { repository, findMany } = buildRepository();

    await repository.findRecentSucceededRuns({
      agentType: 'WORK_REVIEWER' as never,
      sinceDays: 1,
      limit: 5,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          endedAt: { gte: new Date('2026-07-07T15:00:00.000Z') },
        }),
      }),
    );
  });

  it('sinceDays=7 이면 최근 7 KST 캘린더일의 시작으로 조회한다', async () => {
    const { repository, findMany } = buildRepository();

    await repository.findRecentSucceededRuns({
      agentType: 'PO_EVAL' as never,
      sinceDays: 7,
      limit: 5,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          endedAt: { gte: new Date('2026-07-01T15:00:00.000Z') },
        }),
      }),
    );
  });
});

describe('AgentRunPrismaRepository.findChainFromRoot — V3 chain audit walk', () => {
  const buildRepository = (
    queryResult: Array<{
      id: number;
      parent_id: number | null;
      agent_type: string;
      status: string;
      started_at: Date;
      ended_at: Date | null;
      depth: number;
    }>,
  ): { repo: AgentRunPrismaRepository; queryRaw: jest.Mock } => {
    const queryRaw = jest.fn().mockResolvedValue(queryResult);
    const prismaMock = { $queryRaw: queryRaw } as unknown as PrismaService;
    return { repo: new AgentRunPrismaRepository(prismaMock), queryRaw };
  };

  it('recursive CTE 결과를 AgentRunChainNode (camelCase + AgentRunStatus enum) 으로 매핑', async () => {
    const startedAt = new Date('2026-05-28T10:00:00Z');
    const endedAt = new Date('2026-05-28T10:00:30Z');
    const { repo, queryRaw } = buildRepository([
      {
        id: 100,
        parent_id: null,
        agent_type: 'PM',
        status: 'SUCCEEDED',
        started_at: startedAt,
        ended_at: endedAt,
        depth: 0,
      },
      {
        id: 101,
        parent_id: 100,
        agent_type: 'CTO',
        status: 'SUCCEEDED',
        started_at: startedAt,
        ended_at: endedAt,
        depth: 1,
      },
    ]);

    const result = await repo.findChainFromRoot({
      rootRunId: 100,
      maxDepth: 16,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        id: 100,
        parentId: null,
        agentType: 'PM',
        status: AgentRunStatus.SUCCEEDED,
        startedAt,
        endedAt,
        depth: 0,
      },
      {
        id: 101,
        parentId: 100,
        agentType: 'CTO',
        status: AgentRunStatus.SUCCEEDED,
        startedAt,
        endedAt,
        depth: 1,
      },
    ]);
  });

  it('빈 결과 (root 존재 X) 도 graceful — 빈 배열 그대로 반환', async () => {
    const { repo } = buildRepository([]);

    await expect(
      repo.findChainFromRoot({ rootRunId: 999, maxDepth: 16 }),
    ).resolves.toEqual([]);
  });

  it('FAILED status 도 AgentRunStatus enum 으로 매핑 (chain 안 일부 실패 케이스)', async () => {
    const startedAt = new Date('2026-05-28T10:00:00Z');
    const { repo } = buildRepository([
      {
        id: 1,
        parent_id: null,
        agent_type: 'PM',
        status: 'SUCCEEDED',
        started_at: startedAt,
        ended_at: startedAt,
        depth: 0,
      },
      {
        id: 2,
        parent_id: 1,
        agent_type: 'CTO',
        status: 'FAILED',
        started_at: startedAt,
        ended_at: startedAt,
        depth: 1,
      },
    ]);

    const result = await repo.findChainFromRoot({
      rootRunId: 1,
      maxDepth: 16,
    });

    expect(result[1].status).toBe(AgentRunStatus.FAILED);
  });
});

describe('AgentRunPrismaRepository.findChainRootsInWindow', () => {
  it('부모 없고 자식 있는 run 만 window 안에서 최신순으로 조회한다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    const findMany = jest.fn().mockResolvedValue([{ id: 42 }, { id: 7 }]);
    const prismaMock = {
      agentRun: { findMany },
    } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    const result = await repository.findChainRootsInWindow({
      sinceDays: 7,
      limit: 20,
    });

    expect(result).toEqual([42, 7]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        parentId: null,
        startedAt: { gte: new Date('2026-07-15T00:00:00.000Z') },
        children: { some: {} },
      },
      select: { id: true },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    jest.useRealTimers();
  });

  it('뿌리가 없으면 빈 배열', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prismaMock = {
      agentRun: { findMany },
    } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    await expect(
      repository.findChainRootsInWindow({ sinceDays: 7, limit: 20 }),
    ).resolves.toEqual([]);
  });
});

describe('AgentRunPrismaRepository.findRecentlyFinishedRuns', () => {
  it('cutoff(withinMinutes) 를 where 로 좁혀 distinct 하고, 최신 종료 결과를 성공·실패 모두 반환', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
    // findMany 는 이미 where(cutoff)+distinct 가 적용된 "agentType별 최신 종료" 를 돌려준다.
    const findMany = jest.fn().mockResolvedValue([
      { agentType: 'PM', status: 'FAILED', id: 11 },
      { agentType: 'BE', status: 'SUCCEEDED', id: 12 },
    ]);
    const prismaMock = {
      agentRun: { findMany },
    } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    const result = await repository.findRecentlyFinishedRuns({
      withinMinutes: 360,
    });

    // 성공도 그대로 실어 보낸다 — 콘솔 스냅샷이 COMPLETED 를 만들려면 이 값이 필요하다.
    // runId 도 함께 — 콘솔이 "이 완료는 확인했다" 를 식별하는 키다.
    expect(result).toEqual([
      { agentType: 'PM', status: 'FAILED', runId: 11 },
      { agentType: 'BE', status: 'SUCCEEDED', runId: 12 },
    ]);
    // cutoff 를 where 로 밀어넣어 오래된 이력을 스캔하지 않는다(360분 전 = 06:00).
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endedAt: { gte: new Date('2026-07-30T06:00:00.000Z') } },
        orderBy: [{ agentType: 'asc' }, { endedAt: 'desc' }],
        distinct: ['agentType'],
        select: { agentType: true, status: true, id: true },
      }),
    );
    jest.useRealTimers();
  });

  it('종료가 아닌 상태(IN_PROGRESS)는 제외한다 — endedAt 이 채워진 행이 섞여도 완료로 오표시하지 않는다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { agentType: 'PM', status: 'IN_PROGRESS', id: 21 },
      { agentType: 'BE', status: 'SUCCEEDED', id: 22 },
    ]);
    const prismaMock = {
      agentRun: { findMany },
    } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    const result = await repository.findRecentlyFinishedRuns({
      withinMinutes: 60,
    });

    expect(result).toEqual([
      { agentType: 'BE', status: 'SUCCEEDED', runId: 22 },
    ]);
  });
});

describe('AgentRunPrismaRepository.findLatestSweepReview', () => {
  const buildRepository = (
    row: unknown,
  ): { repository: AgentRunPrismaRepository } => {
    const findFirst = jest.fn().mockResolvedValue(row);
    const prismaMock = {
      agentRun: { findFirst },
    } as unknown as PrismaService;
    return { repository: new AgentRunPrismaRepository(prismaMock) };
  };

  const query = { prRef: 'JSL107/personal_agents#189', sinceDays: 30 };

  it('inputSnapshot.dryRun 이 true 면 연습 모드 리뷰로 읽는다', async () => {
    const { repository } = buildRepository({
      status: 'SUCCEEDED',
      startedAt: new Date('2026-07-31T00:00:00.000Z'),
      inputSnapshot: { prRef: query.prRef, dryRun: true },
    });

    const result = await repository.findLatestSweepReview(query);

    expect(result?.dryRun).toBe(true);
  });

  it('dryRun 누락·비 boolean 은 실게시(false)로 본다 — 판정이 재리뷰 쪽으로 새지 않게', async () => {
    const { repository } = buildRepository({
      status: 'SUCCEEDED',
      startedAt: new Date('2026-07-31T00:00:00.000Z'),
      inputSnapshot: { prRef: query.prRef, dryRun: 'true' },
    });

    const result = await repository.findLatestSweepReview(query);

    expect(result?.dryRun).toBe(false);
  });

  it('레코드가 없으면 null', async () => {
    const { repository } = buildRepository(null);

    const result = await repository.findLatestSweepReview(query);

    expect(result).toBeNull();
  });
});

describe('AgentRunPrismaRepository.countUnsuccessfulSweepReviews', () => {
  it('최근 24시간 FAILED/IN_PROGRESS 스윕 리뷰를 prRef 기준으로 세고 count를 반환한다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-03T01:00:00.000Z'));
    const count = jest.fn().mockResolvedValue(2);
    const prismaMock = {
      agentRun: { count },
    } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    const result = await repository.countUnsuccessfulSweepReviews({
      prRef: 'JSL107/personal_agents#189',
      sinceHours: 24,
    });

    expect(result).toBe(2);
    expect(count).toHaveBeenCalledWith({
      where: {
        triggerType: 'PR_REVIEW_SWEEP',
        status: { not: AgentRunStatus.SUCCEEDED },
        startedAt: { gte: new Date('2026-08-02T01:00:00.000Z') },
        inputSnapshot: {
          path: ['prRef'],
          equals: 'JSL107/personal_agents#189',
        },
      },
    });
    jest.useRealTimers();
  });
});

describe('AgentRunPrismaRepository.findAllRunsForLedger', () => {
  it('원장 전량에서 집계용 4필드만 조회한다', async () => {
    const rows = [
      {
        agentType: 'PM',
        triggerType: 'MORNING_BRIEFING_CRON',
        status: 'SUCCEEDED',
        startedAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    const prismaMock = {
      agentRun: { findMany },
    } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    const result = await repository.findAllRunsForLedger();

    expect(result).toEqual(rows);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      select: {
        agentType: true,
        triggerType: true,
        status: true,
        startedAt: true,
      },
    });
  });
});
