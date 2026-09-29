import { CodeChunk } from '../domain/code-chunk.type';
import {
  CODE_GRAPH_SNAPSHOT_VERSION,
  CodeGraphSnapshot,
} from '../domain/code-graph.type';
import { CodeRelation } from '../domain/code-relation.type';
import { CodeGraphQueryUsecase } from './code-graph-query.usecase';

describe('CodeGraphQueryUsecase', () => {
  let usecase: CodeGraphQueryUsecase;

  beforeEach(() => {
    usecase = new CodeGraphQueryUsecase();
  });

  const buildSnapshot = (relations: CodeRelation[]): CodeGraphSnapshot => ({
    version: CODE_GRAPH_SNAPSHOT_VERSION,
    rootDir: '/repo',
    builtAt: '2026-04-29T00:00:00.000Z',
    chunks: [],
    relations,
  });

  describe('findImplementersOf', () => {
    it('Port 를 implements 한 class 들을 반환', () => {
      const snapshot = buildSnapshot([
        { kind: 'implements', from: 'FooAdapter', to: 'FooPort' },
        { kind: 'implements', from: 'BarAdapter', to: 'FooPort' },
        { kind: 'implements', from: 'BazAdapter', to: 'OtherPort' },
      ]);
      expect(
        usecase.findImplementersOf({ snapshot, portName: 'FooPort' }).sort(),
      ).toEqual(['BarAdapter', 'FooAdapter']);
    });

    it('매칭 없으면 빈 배열', () => {
      const snapshot = buildSnapshot([
        { kind: 'implements', from: 'A', to: 'X' },
      ]);
      expect(
        usecase.findImplementersOf({ snapshot, portName: 'NoSuch' }),
      ).toEqual([]);
    });

    it('중복 from 은 한 번만', () => {
      const snapshot = buildSnapshot([
        { kind: 'implements', from: 'Foo', to: 'P' },
        { kind: 'implements', from: 'Foo', to: 'P' },
      ]);
      expect(usecase.findImplementersOf({ snapshot, portName: 'P' })).toEqual([
        'Foo',
      ]);
    });
  });

  describe('findCallersOf', () => {
    it('단순 식별자 호출 매칭', () => {
      const snapshot = buildSnapshot([
        { kind: 'calls', from: 'a.ts', to: 'foo', callSite: { line: 10 } },
        { kind: 'calls', from: 'b.ts', to: 'bar', callSite: { line: 5 } },
      ]);
      expect(usecase.findCallersOf({ snapshot, functionName: 'foo' })).toEqual([
        { filePath: 'a.ts', line: 10 },
      ]);
    });

    it('member 호출 (obj.foo) 의 마지막 segment 매칭', () => {
      const snapshot = buildSnapshot([
        { kind: 'calls', from: 'a.ts', to: 'obj.foo', callSite: { line: 7 } },
        { kind: 'calls', from: 'b.ts', to: 'this.foo', callSite: { line: 3 } },
        { kind: 'calls', from: 'c.ts', to: 'Foo.bar', callSite: { line: 1 } },
      ]);
      const result = usecase.findCallersOf({ snapshot, functionName: 'foo' });
      expect(result).toContainEqual({ filePath: 'a.ts', line: 7 });
      expect(result).toContainEqual({ filePath: 'b.ts', line: 3 });
      expect(result).not.toContainEqual({ filePath: 'c.ts', line: 1 });
    });
  });

  describe('findExtendersOf', () => {
    it('class 와 interface 모두 매칭', () => {
      const snapshot = buildSnapshot([
        { kind: 'extends', from: 'Child', to: 'Parent' },
        { kind: 'extends', from: 'GrandChild', to: 'Child' },
        { kind: 'extends', from: 'OtherChild', to: 'Parent' },
      ]);
      expect(
        usecase.findExtendersOf({ snapshot, className: 'Parent' }).sort(),
      ).toEqual(['Child', 'OtherChild']);
    });

    it('순환 extends 가 있어도 단일 hop 매칭만 — cycle 영향 없음', () => {
      // A extends B, B extends A 같은 비정상 입력에서도 query 가 무한 루프 X.
      const snapshot = buildSnapshot([
        { kind: 'extends', from: 'A', to: 'B' },
        { kind: 'extends', from: 'B', to: 'A' },
      ]);
      expect(usecase.findExtendersOf({ snapshot, className: 'A' })).toEqual([
        'B',
      ]);
      expect(usecase.findExtendersOf({ snapshot, className: 'B' })).toEqual([
        'A',
      ]);
    });
  });

  describe('findFilesAffectedByImport', () => {
    it('정확히 import path 가 일치하는 파일 모두 반환', () => {
      const snapshot = buildSnapshot([
        {
          kind: 'imports',
          from: 'a.ts',
          to: '@prisma/client',
          symbols: ['PrismaClient'],
        },
        {
          kind: 'imports',
          from: 'b.ts',
          to: '@prisma/client',
          symbols: ['Prisma'],
        },
        { kind: 'imports', from: 'c.ts', to: 'lodash', symbols: [] },
      ]);
      expect(
        usecase
          .findFilesAffectedByImport({
            snapshot,
            importPath: '@prisma/client',
          })
          .sort(),
      ).toEqual(['a.ts', 'b.ts']);
    });

    it('서브패스 (prefix + /) 도 매칭', () => {
      const snapshot = buildSnapshot([
        {
          kind: 'imports',
          from: 'a.ts',
          to: '@prisma/client',
          symbols: [],
        },
        {
          kind: 'imports',
          from: 'b.ts',
          to: '@prisma/client/runtime',
          symbols: [],
        },
        { kind: 'imports', from: 'c.ts', to: '@prisma/utils', symbols: [] },
      ]);
      const result = usecase.findFilesAffectedByImport({
        snapshot,
        importPath: '@prisma/client',
      });
      expect(result.sort()).toEqual(['a.ts', 'b.ts']);
    });

    it('동일 파일에서 같은 path 를 여러 번 import 해도 한 번만', () => {
      const snapshot = buildSnapshot([
        { kind: 'imports', from: 'a.ts', to: 'foo', symbols: ['x'] },
        { kind: 'imports', from: 'a.ts', to: 'foo', symbols: ['y'] },
      ]);
      expect(
        usecase.findFilesAffectedByImport({ snapshot, importPath: 'foo' }),
      ).toEqual(['a.ts']);
    });
  });

  it('빈 snapshot 은 모든 query 가 빈 배열 반환', () => {
    const snapshot = buildSnapshot([]);
    expect(usecase.findImplementersOf({ snapshot, portName: 'X' })).toEqual([]);
    expect(usecase.findCallersOf({ snapshot, functionName: 'x' })).toEqual([]);
    expect(usecase.findExtendersOf({ snapshot, className: 'X' })).toEqual([]);
    expect(
      usecase.findFilesAffectedByImport({ snapshot, importPath: 'x' }),
    ).toEqual([]);
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
      version: CODE_GRAPH_SNAPSHOT_VERSION,
      rootDir: '/repo',
      builtAt: '2026-09-29T00:00:00.000Z',
      chunks,
      relations: [],
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
