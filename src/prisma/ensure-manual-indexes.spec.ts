import { ensureManualIndexes, RawSqlExecutor } from './ensure-manual-indexes';

type IndexRow = { indexname: string; valid: boolean };

// 카탈로그 상태를 들고 SQL 을 흉내 내는 최소 실행기. 생성 구문은 이름을 valid 로 등록한다.
const makeExecutor = (
  initial: IndexRow[],
  failWhen: (sql: string) => boolean = () => false,
) => {
  const catalog = new Map(initial.map((row) => [row.indexname, row.valid]));
  const executed: string[] = [];
  const executor: RawSqlExecutor = {
    $executeRawUnsafe: async (sql: string) => {
      executed.push(sql);
      if (failWhen(sql)) {
        throw new Error('boom');
      }
      const dropped = /DROP INDEX CONCURRENTLY IF EXISTS (\w+)/.exec(sql);
      if (dropped) {
        catalog.delete(dropped[1]);
        return 0;
      }
      const created = /INDEX (?:CONCURRENTLY )?IF NOT EXISTS (\w+)/.exec(sql);
      if (created && !catalog.has(created[1])) {
        catalog.set(created[1], true);
      }
      return 0;
    },
    $queryRawUnsafe: async <T>() => {
      return [...catalog].map(([indexname, valid]) => ({
        indexname,
        valid,
      })) as T;
    },
  };
  return { executor, executed };
};

const ALL_VALID: IndexRow[] = [
  { indexname: 'idx_agent_run_output_fts', valid: true },
  { indexname: 'idx_episodic_memory_embedding', valid: true },
  { indexname: 'idx_strategy_parameter_active', valid: true },
];

const stateOf = (
  outcomes: Awaited<ReturnType<typeof ensureManualIndexes>>,
  name: string,
) => {
  return outcomes.find((outcome) => outcome.name === name)?.state;
};

describe('ensureManualIndexes', () => {
  it('없는 인덱스는 created, 있던 것은 kept 로 낸다', async () => {
    const { executor } = makeExecutor(
      ALL_VALID.filter(
        (row) => row.indexname !== 'idx_episodic_memory_embedding',
      ),
    );
    const outcomes = await ensureManualIndexes(executor);
    expect(stateOf(outcomes, 'idx_episodic_memory_embedding')).toBe('created');
    expect(stateOf(outcomes, 'idx_agent_run_output_fts')).toBe('kept');
  });

  // 이름만 보면 invalid 인덱스가 "유지" 로 통과한다 — 쿼리에 안 쓰이는데 정상처럼 보인다.
  it('invalid 인덱스는 지우고 다시 만든다', async () => {
    const { executor, executed } = makeExecutor([
      { indexname: 'idx_agent_run_output_fts', valid: false },
      ...ALL_VALID.slice(1),
    ]);
    const outcomes = await ensureManualIndexes(executor);
    expect(stateOf(outcomes, 'idx_agent_run_output_fts')).toBe('rebuilt');
    expect(executed).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS idx_agent_run_output_fts',
    );
  });

  // 한 구문의 실패가 뒤 구문을 막으면 pgvector 없는 DB 에서 단일 활성 불변식까지 사라진다.
  it('확장 생성이 실패해도 뒤 인덱스는 만든다', async () => {
    const { executor } = makeExecutor([], (sql) => sql.includes('EXTENSION'));
    const outcomes = await ensureManualIndexes(executor);
    expect(stateOf(outcomes, 'CREATE EXTENSION IF NOT EXISTS vector')).toBe(
      'failed',
    );
    expect(stateOf(outcomes, 'idx_strategy_parameter_active')).toBe('created');
  });

  it('생성 구문이 성공해도 결과가 invalid 면 failed 로 낸다', async () => {
    const { executor } = makeExecutor([]);
    const query = executor.$queryRawUnsafe;
    let call = 0;
    executor.$queryRawUnsafe = async <T>() => {
      call += 1;
      const rows = (await query<IndexRow[]>('')) as IndexRow[];
      return (
        call === 1
          ? rows
          : rows.map((row) => ({
              ...row,
              valid: row.indexname !== 'idx_agent_run_output_fts',
            }))
      ) as T;
    };
    const outcomes = await ensureManualIndexes(executor);
    expect(stateOf(outcomes, 'idx_agent_run_output_fts')).toBe('failed');
  });
});
