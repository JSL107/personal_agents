import { PrismaService } from '../../prisma/prisma.service';
import { ApplicabilityJudgement } from '../domain/study-applicability.type';
import { StudyBriefPrismaRepository } from './study-brief.prisma.repository';

describe('StudyBriefPrismaRepository', () => {
  it('브리핑 원장을 저장한다', async () => {
    const create = jest.fn().mockResolvedValue({ id: 7 });
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { create },
    } as unknown as PrismaService);

    await expect(
      repository.save({
        agentRunId: 41,
        ownerUserId: 'U1',
        kind: 'CONCEPT',
        topic: 'durable execution',
        verdict: {
          kind: 'CONCEPT',
          whyNow: '지금 필요',
          whereItLands: 'src/agent-run/',
          minutes: 10,
        },
        reportMd: 'report',
        sourceUrls: ['https://example.com'],
        keywords: ['hook', 'settings'],
      }),
    ).resolves.toEqual({ id: 7 });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentRunId: 41,
        ownerUserId: 'U1',
        topic: 'durable execution',
        studyKeywords: ['hook', 'settings'],
      }),
      select: { id: true },
    });
  });

  it('미판정 브리프를 오래된 것부터 1건 고르고 키워드를 문자열 배열로 돌려준다', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 5,
      kind: 'CONCEPT',
      topic: 'Hooks',
      verdictJson: {},
      reportMd: 'r',
      sourceUrls: ['https://a'],
      createdAt: new Date('2026-09-29T00:30:00Z'),
      notionUrl: null,
      studyKeywords: ['hook', 3],
    });
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { findFirst },
    } as unknown as PrismaService);
    const since = new Date('2026-09-27T01:30:00Z');

    const found = await repository.findOldestUnjudgedSince('U1', since);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerUserId: 'U1',
          createdAt: { gte: since },
          applicability: null,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(found).toMatchObject({ id: 5, keywords: ['hook'], notionUrl: null });
  });

  it('applicability 가 null 일 때만 판정을 저장한다', async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { updateMany },
    } as unknown as PrismaService);
    const judgement: ApplicabilityJudgement = {
      verdict: 'NOT_APPLICABLE',
      rawVerdict: null,
      reason: 'r',
      citations: [],
      droppedCitations: [],
      downgradeReason: null,
      proposal: null,
      candidateCount: 0,
    };

    await expect(repository.saveApplicability(5, judgement)).resolves.toBe(
      true,
    );
    await expect(repository.saveApplicability(5, judgement)).resolves.toBe(
      false,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 5, applicability: null },
      data: expect.objectContaining({ applicability: 'NOT_APPLICABLE' }),
    });
  });

  it('findTopicsByIds 는 id 와 주제의 map 을 돌려준다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 5, topic: 'Hooks' },
      { id: 8, topic: 'Agents' },
    ]);
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { findMany },
    } as unknown as PrismaService);
    await expect(repository.findTopicsByIds([5, 8])).resolves.toEqual(
      new Map([
        [5, 'Hooks'],
        [8, 'Agents'],
      ]),
    );
  });

  it('판정 분포·강등·48시간 초과 미판정을 집계한다', async () => {
    const now = new Date('2026-09-29T12:00:00Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        applicability: 'APPLY',
        applicabilityJson: { rawVerdict: 'APPLY', downgradeReason: null },
        createdAt: new Date('2026-09-29T00:00:00Z'),
      },
      {
        applicability: 'REFERENCE',
        applicabilityJson: {
          rawVerdict: 'APPLY',
          downgradeReason: 'NO_VALID_CITATION',
        },
        createdAt: new Date('2026-09-28T00:00:00Z'),
      },
      {
        applicability: null,
        applicabilityJson: null,
        createdAt: new Date('2026-09-26T12:00:00Z'),
      },
      {
        applicability: null,
        applicabilityJson: null,
        createdAt: new Date('2026-09-29T11:00:00Z'),
      },
    ]);
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { findMany },
    } as unknown as PrismaService);
    const since = new Date('2026-08-30T12:00:00Z');

    await expect(
      repository.countApplicabilitySince(since, now),
    ).resolves.toMatchObject({
      apply: 1,
      reference: 1,
      rawApply: 2,
      downgradeNoValidCitation: 1,
      unjudgedExpired: 1,
    });
  });

  it('기준 시각 이후 브리핑을 최신순으로 조회한다', async () => {
    const since = new Date('2026-07-01T00:00:00Z');
    const rows = [
      {
        kind: 'TOOL',
        topic: 'context7',
        createdAt: new Date('2026-07-02T00:00:00Z'),
      },
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { findMany },
    } as unknown as PrismaService);

    await expect(repository.findRecentSince('U1', since)).resolves.toEqual(
      rows,
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { ownerUserId: 'U1', createdAt: { gte: since } },
      select: { kind: true, topic: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('발행된 Notion URL을 저장한다', async () => {
    const update = jest.fn().mockResolvedValue({ id: 7 });
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { update },
    } as unknown as PrismaService);

    await repository.updateNotionUrl(7, 'https://notion.so/PAGE');

    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { notionUrl: 'https://notion.so/PAGE' },
    });
  });

  // 이 조건(blogDraftPageId: null)이 빠지면 같은 브리프를 매일 다시 확장해 초안이 중복 적재된다.
  it('아직 확장하지 않은 브리프만 오래된 순 1건 조회한다', async () => {
    const since = new Date('2026-08-18T00:00:00Z');
    const findFirst = jest.fn().mockResolvedValue({
      id: 42,
      kind: 'CONCEPT',
      topic: 'threat modeling',
      verdictJson: {
        kind: 'CONCEPT',
        whyNow: '지금',
        whereItLands: 'router',
        minutes: 15,
      },
      reportMd: 'report',
      sourceUrls: ['https://example.com', 42, null],
      createdAt: new Date('2026-08-20T00:30:00Z'),
    });
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { findFirst },
    } as unknown as PrismaService);

    const found = await repository.findOldestUnexpandedSince('U1', since);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        ownerUserId: 'U1',
        createdAt: { gte: since },
        blogDraftPageId: null,
      },
      // 오래된 것부터 — 실패해 남은 브리프가 새 브리프에 밀리면 48시간 창을 그냥 넘어간다.
      orderBy: { createdAt: 'asc' },
      select: expect.objectContaining({ reportMd: true, verdictJson: true }),
    });
    // Json 컬럼이라 문자열이 아닌 값이 섞여 있을 수 있다 — 걸러내지 않으면 프롬프트에 박힌다.
    expect(found?.sourceUrls).toEqual(['https://example.com']);
  });

  it('확장 대상이 없으면 undefined 를 반환한다', async () => {
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService);

    await expect(
      repository.findOldestUnexpandedSince('U1', new Date()),
    ).resolves.toBeUndefined();
  });

  it('findLatest 는 소유자의 가장 최근 브리프를 확장 여부와 무관하게 돌려준다', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 12,
      kind: 'CONCEPT',
      topic: 'durable execution',
      verdictJson: {
        kind: 'CONCEPT',
        whyNow: '지금 필요',
        whereItLands: 'src/agent-run/',
        minutes: 10,
      },
      reportMd: 'report',
      sourceUrls: ['https://example.com'],
      createdAt: new Date('2026-08-30T00:30:00Z'),
    });
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { findFirst },
    } as unknown as PrismaService);

    const found = await repository.findLatest('U1');

    expect(findFirst).toHaveBeenCalledWith({
      where: { ownerUserId: 'U1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(found).toMatchObject({ id: 12, topic: 'durable execution' });
  });

  it('findLatest 는 기록이 없으면 undefined 다', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { findFirst },
    } as unknown as PrismaService);

    await expect(repository.findLatest('U1')).resolves.toBeUndefined();
  });

  it('findById 는 id 로 브리프 1건을 조회한다', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 42,
      kind: 'TOOL',
      topic: 'context7',
      verdictJson: {
        kind: 'TOOL',
        whyNow: '지금 필요',
        whereItLands: 'src/mcp/',
        minutes: 5,
      },
      reportMd: 'report',
      sourceUrls: ['https://example.com'],
      createdAt: new Date('2026-08-30T00:30:00Z'),
    });
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { findUnique },
    } as unknown as PrismaService);

    const found = await repository.findById(42);

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(found).toMatchObject({ id: 42, topic: 'context7' });
  });

  it('findById 는 없는 id 에 undefined 다', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { findUnique },
    } as unknown as PrismaService);

    await expect(repository.findById(999)).resolves.toBeUndefined();
  });

  it('확장 완료 page id 를 기록한다', async () => {
    const update = jest.fn().mockResolvedValue({});
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { update },
    } as unknown as PrismaService);

    await repository.markBlogDraftCreated(42, 'notion-page-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { blogDraftPageId: 'notion-page-1' },
    });
  });
});
