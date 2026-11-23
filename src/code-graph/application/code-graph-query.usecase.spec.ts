import { CodeChunk } from '../domain/code-chunk.type';
import { CodeGraphSnapshot } from '../domain/code-graph.type';
import { CodeGraphQueryUsecase } from './code-graph-query.usecase';

describe('CodeGraphQueryUsecase', () => {
  let usecase: CodeGraphQueryUsecase;

  beforeEach(() => {
    usecase = new CodeGraphQueryUsecase();
  });

  describe('findChunksByKeywords', () => {
    const chunk = (
      name: string,
      kind: CodeChunk['kind'] = 'function',
      source = '',
    ): CodeChunk => ({
      filePath: `src/${name}.ts`,
      kind,
      name,
      startLine: 1,
      endLine: 2,
      source,
    });
    const snapshotOf = (chunks: CodeChunk[]): CodeGraphSnapshot => ({
      rootDir: '/repo',
      builtAt: '2026-09-29T00:00:00.000Z',
      chunks,
    });
    const filler = (count: number): CodeChunk[] =>
      Array.from({ length: count }, (_, index) => chunk(`filler${index}`));

    it('토큰 단위로 비교해 hook 이 webhook 에 걸리지 않는다', () => {
      const result = usecase.findChunksByKeywords({
        snapshot: snapshotOf([
          chunk('installStopHook'),
          chunk('handleWebhook'),
          ...filler(100),
        ]),
        keywords: ['hook'],
        limit: 12,
      });
      expect(result.map((candidate) => candidate.name)).toEqual([
        'installStopHook',
      ]);
      expect(result[0].id).toBe('c1');
    });

    it('전체 조각의 2% 이상 이름에 나오는 키워드는 점수에서 뺀다', () => {
      const result = usecase.findChunksByKeywords({
        snapshot: snapshotOf([
          chunk('runA'),
          chunk('runB'),
          chunk('runC'),
          chunk('buildClaudeArgs'),
          ...filler(96),
        ]),
        keywords: ['run', 'claude'],
        limit: 12,
      });
      expect(result.map((candidate) => candidate.name)).toEqual([
        'buildClaudeArgs',
      ]);
    });

    it('같은 점수면 method·function 을 class 보다 앞에 두고 limit 로 자른다', () => {
      const result = usecase.findChunksByKeywords({
        snapshot: snapshotOf([
          chunk('ClaudeProvider', 'class'),
          chunk('spawnClaude', 'method'),
          chunk('buildClaudeArgs', 'function'),
          ...filler(200),
        ]),
        keywords: ['claude'],
        limit: 2,
      });
      expect(result.map((candidate) => candidate.kind)).toEqual([
        'method',
        'function',
      ]);
      expect(result.map((candidate) => candidate.id)).toEqual(['c1', 'c2']);
    });

    it('이름에 없어도 원문에 단어로 나오면 낮은 점수로 잡는다', () => {
      const result = usecase.findChunksByKeywords({
        snapshot: snapshotOf([
          chunk('buildArgs', 'function', "['--setting-sources']"),
          ...filler(100),
        ]),
        keywords: ['setting'],
        limit: 12,
      });
      expect(result.map((candidate) => candidate.name)).toEqual(['buildArgs']);
    });

    it('식별자를 통째로 붙인 키워드는 전체 이름 일치로 낱말 일치와 같은 10점을 준다', () => {
      const result = usecase.findChunksByKeywords({
        snapshot: snapshotOf([
          chunk('splitKeywords'),
          chunk('IntentClassifierUsecase', 'class'),
          ...filler(200),
        ]),
        keywords: ['split', 'intentclassifierusecase'],
        limit: 12,
      });
      expect(
        result.map((candidate) => [candidate.name, candidate.score]),
      ).toEqual([
        ['splitKeywords', 10],
        ['IntentClassifierUsecase', 10],
      ]);
    });

    it('전체 이름 일치에 본문 점수가 더해지면 낱말 일치 후보를 제치고 상한 안에 든다', () => {
      const splits = Array.from({ length: 12 }, (_, index) =>
        chunk(`splitItems${index}`),
      );
      const result = usecase.findChunksByKeywords({
        snapshot: snapshotOf([
          ...splits,
          chunk('IntentClassifierUsecase', 'class', 'run(priorTurns)'),
          ...filler(700),
        ]),
        keywords: ['split', 'intentclassifierusecase', 'priorturns'],
        limit: 12,
      });
      expect(result).toHaveLength(12);
      expect([result[0].name, result[0].score]).toEqual([
        'IntentClassifierUsecase',
        11,
      ]);
    });

    it('같은 전체 이름이 여러 조각에 있어도 2% 필터가 키워드를 지우지 않는다', () => {
      const result = usecase.findChunksByKeywords({
        snapshot: snapshotOf([
          chunk('runAll', 'function', 'runAll()'),
          chunk('runAll', 'method', 'runAll()'),
          ...filler(98),
        ]),
        keywords: ['runall'],
        limit: 12,
      });
      expect(result.map((candidate) => candidate.score)).toEqual([11, 11]);
    });

    it('기호만 있는 키워드는 낱말이 없는 이름과 맞지 않는다', () => {
      const result = usecase.findChunksByKeywords({
        snapshot: snapshotOf([chunk('_'), ...filler(100)]),
        keywords: ['--'],
        limit: 12,
      });
      expect(result).toEqual([]);
    });

    it('이름의 일부만 이어 붙인 키워드는 이름 일치로 치지 않는다', () => {
      const result = usecase.findChunksByKeywords({
        snapshot: snapshotOf([chunk('installStopHook'), ...filler(100)]),
        keywords: ['stophook'],
        limit: 12,
      });
      expect(result).toEqual([]);
    });

    it('밑줄로 이은 키워드도 전체 이름과 비교한다', () => {
      const result = usecase.findChunksByKeywords({
        snapshot: snapshotOf([
          chunk('IntentClassifier', 'class'),
          ...filler(100),
        ]),
        keywords: ['intent_classifier'],
        limit: 12,
      });
      expect(result.map((candidate) => candidate.name)).toEqual([
        'IntentClassifier',
      ]);
    });

    it('흔한 낱말로 이뤄진 이름이라도 전체 이름 일치는 2% 필터에 걸리지 않는다', () => {
      const result = usecase.findChunksByKeywords({
        snapshot: snapshotOf([
          chunk('runA'),
          chunk('runB'),
          chunk('runC'),
          chunk('runAll'),
          ...filler(96),
        ]),
        keywords: ['run', 'runall'],
        limit: 12,
      });
      expect(result.map((candidate) => candidate.name)).toEqual(['runAll']);
    });

    it('키워드가 비면 빈 배열', () => {
      expect(
        usecase.findChunksByKeywords({
          snapshot: snapshotOf([chunk('a')]),
          keywords: [],
          limit: 12,
        }),
      ).toEqual([]);
    });
  });
});
