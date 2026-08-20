import { PrismaService } from '../../prisma/prisma.service';
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
      }),
    ).resolves.toEqual({ id: 7 });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentRunId: 41,
        ownerUserId: 'U1',
        topic: 'durable execution',
      }),
      select: { id: true },
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
