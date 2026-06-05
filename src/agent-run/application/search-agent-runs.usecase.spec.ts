import {
  AgentRunRepositoryPort,
  SearchAgentRunRow,
} from '../domain/port/agent-run.repository.port';
import { SearchAgentRunsUsecase } from './search-agent-runs.usecase';

describe('SearchAgentRunsUsecase', () => {
  const buildRepo = (
    rows: SearchAgentRunRow[],
  ): jest.Mocked<AgentRunRepositoryPort> => {
    const repo: Partial<jest.Mocked<AgentRunRepositoryPort>> = {
      searchByKeyword: jest.fn().mockResolvedValue(rows),
    };
    return repo as jest.Mocked<AgentRunRepositoryPort>;
  };

  it('keyword + slackUserId + default limit (10) 로 repository 호출', async () => {
    const repo = buildRepo([]);
    const usecase = new SearchAgentRunsUsecase(repo);

    await usecase.execute({ slackUserId: 'U1', keyword: '결제' });

    expect(repo.searchByKeyword).toHaveBeenCalledWith({
      slackUserId: 'U1',
      keyword: '결제',
      limit: SearchAgentRunsUsecase.DEFAULT_LIMIT,
    });
  });

  it('repository row 를 snippet 포함 SearchAgentRunsResultRow 로 변환', async () => {
    const endedAt = new Date('2026-05-30T10:00:00Z');
    const repo = buildRepo([
      {
        id: 42,
        agentType: 'PM',
        endedAt,
        output: { topPriority: { title: '결제 검증 API 추가', detail: '...' } },
        inputSnapshot: { slackUserId: 'U1' },
      },
    ]);
    const usecase = new SearchAgentRunsUsecase(repo);

    const result = await usecase.execute({
      slackUserId: 'U1',
      keyword: '결제',
    });

    expect(result.keyword).toBe('결제');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: 42,
      agentType: 'PM',
      endedAt,
    });
    // snippet 에 키워드 그대로 포함 — 사용자가 어떤 row 인지 즉시 식별 가능.
    expect(result.rows[0].snippet).toContain('결제');
  });

  it('repository 가 limit 만큼 반환 시 truncated=true (사용자에게 "더 있음" 표시)', async () => {
    const fakeRow: SearchAgentRunRow = {
      id: 1,
      agentType: 'PM',
      endedAt: new Date(),
      output: { x: '결제' },
      inputSnapshot: { slackUserId: 'U1' },
    };
    const repo = buildRepo(Array(3).fill(fakeRow));
    const usecase = new SearchAgentRunsUsecase(repo);

    const result = await usecase.execute({
      slackUserId: 'U1',
      keyword: '결제',
      limit: 3,
    });

    expect(result.truncated).toBe(true);
  });

  it('repository 가 limit 미만 반환 시 truncated=false', async () => {
    const repo = buildRepo([
      {
        id: 1,
        agentType: 'PM',
        endedAt: new Date(),
        output: '결제 본문',
        inputSnapshot: { slackUserId: 'U1' },
      },
    ]);
    const usecase = new SearchAgentRunsUsecase(repo);

    const result = await usecase.execute({
      slackUserId: 'U1',
      keyword: '결제',
      limit: 10,
    });

    expect(result.truncated).toBe(false);
  });

  it('case-insensitive 매칭 — 대문자 키워드도 소문자 텍스트에서 발췌', async () => {
    const repo = buildRepo([
      {
        id: 1,
        agentType: 'PM',
        endedAt: new Date(),
        output: 'before payment after', // 소문자
        inputSnapshot: { slackUserId: 'U1' },
      },
    ]);
    const usecase = new SearchAgentRunsUsecase(repo);

    const result = await usecase.execute({
      slackUserId: 'U1',
      keyword: 'PAYMENT', // 대문자
    });

    expect(result.rows[0].snippet.toLowerCase()).toContain('payment');
  });

  it('키워드가 양쪽 candidate 어디에도 없으면 앞 N 글자 fallback (row 식별용)', async () => {
    // DB ILIKE 가 match 했지만 string 변환 후 키워드를 못 찾는 코너 케이스
    // (예: JSON escape \" 등) — snippet 이 empty 로 떨어지지 않게 fallback.
    const repo = buildRepo([
      {
        id: 1,
        agentType: 'PM',
        endedAt: new Date(),
        output: '비키워드 본문입니다.',
        inputSnapshot: { slackUserId: 'U1' },
      },
    ]);
    const usecase = new SearchAgentRunsUsecase(repo);

    const result = await usecase.execute({
      slackUserId: 'U1',
      keyword: '없는키워드',
    });

    expect(result.rows[0].snippet.length).toBeGreaterThan(0);
  });
});
