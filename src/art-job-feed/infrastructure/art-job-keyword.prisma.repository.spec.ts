import { ArtJobKeywordPrismaRepository } from './art-job-keyword.prisma.repository';

interface KeywordRow {
  id: number;
  kind: string;
  term: string;
  createdBy: string;
}

interface ChangeRow {
  action: string;
  kind: string;
  term: string;
  actor: string;
}

describe('ArtJobKeywordPrismaRepository', () => {
  let keywords: KeywordRow[];
  let changes: ChangeRow[];
  let repository: ArtJobKeywordPrismaRepository;
  let transaction: jest.Mock;

  beforeEach(() => {
    keywords = [];
    changes = [];
    let nextId = 1;
    const client = {
      artJobKeyword: {
        createMany: jest.fn(
          async ({ data }: { data: Omit<KeywordRow, 'id'>[] }) => {
            for (const row of data) {
              if (
                !keywords.some(
                  (keyword) =>
                    keyword.kind === row.kind && keyword.term === row.term,
                )
              ) {
                keywords.push({ ...row, id: nextId++ });
              }
            }
          },
        ),
        findMany: jest.fn(
          async ({ where }: { where?: { kind: string } } = {}) => {
            return where
              ? keywords.filter((row) => row.kind === where.kind)
              : [...keywords];
          },
        ),
        deleteMany: jest.fn(
          async ({ where }: { where: { id: { in: number[] } } }) => {
            keywords = keywords.filter((row) => !where.id.in.includes(row.id));
          },
        ),
      },
      artJobKeywordChange: {
        count: jest.fn(async () => changes.length),
        createMany: jest.fn(async ({ data }: { data: ChangeRow[] }) => {
          changes.push(...data);
        }),
      },
    };
    transaction = jest.fn(
      async (operation: (database: never) => Promise<unknown>) => {
        return await operation(client as never);
      },
    );
    repository = new ArtJobKeywordPrismaRepository({
      $transaction: transaction,
    } as never);
  });

  it('seeds once based on change log, including after every keyword is removed', async () => {
    const initial = await repository.load();
    expect(initial.target).toContain('캐릭터');
    expect(initial.style).toEqual(['북미풍', '캐주얼']);
    expect(changes).toHaveLength(keywords.length);
    const seededCount = changes.length;
    keywords = [];
    expect(await repository.load()).toEqual({
      target: [],
      excluded: [],
      style: [],
    });
    expect(changes).toHaveLength(seededCount);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('deduplicates add and remove without case-sensitive misses and writes audit rows', async () => {
    await repository.load();
    expect(
      await repository.add('STYLE', ['북미풍', 'NORTH', 'north'], 'U1'),
    ).toEqual({
      added: ['NORTH'],
      existing: ['북미풍'],
    });
    expect(
      await repository.remove('STYLE', ['north', '없는 것'], 'U2'),
    ).toEqual({
      removed: ['NORTH'],
      missing: ['없는 것'],
    });
    expect(changes.slice(-2)).toEqual([
      { action: 'ADD', kind: 'STYLE', term: 'NORTH', actor: 'U1' },
      { action: 'REMOVE', kind: 'STYLE', term: 'NORTH', actor: 'U2' },
    ]);
  });

  it('seeds before the first mutation so an initial add does not suppress defaults', async () => {
    await repository.add('STYLE', ['수채화'], 'U1');
    const loaded = await repository.load();
    expect(loaded.target).toContain('원화');
    expect(loaded.style).toEqual(['북미풍', '캐주얼', '수채화']);
    expect(changes.at(-1)).toEqual({
      action: 'ADD',
      kind: 'STYLE',
      term: '수채화',
      actor: 'U1',
    });
  });
});
