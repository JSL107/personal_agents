import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateFindingInput } from '../domain/pr-review-finding.type';
import { PrReviewFindingPrismaRepository } from './pr-review-finding.prisma.repository';

const createInput = (): CreateFindingInput => ({
  agentRunId: 7,
  agentType: 'CODE_REVIEWER',
  repo: 'JSL107/personal_agents',
  pullNumber: 180,
  headSha: 'abc1234',
  category: 'RELIABILITY',
  severity: 'MUST_FIX',
  filePath: 'src/foo.service.ts',
  line: 42,
  body: '트랜잭션 밖에서 저장한다',
  fingerprint: 'fp-1',
  postMode: 'INLINE',
});

const buildPrisma = () => ({
  prReviewFinding: {
    create: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
});

describe('PrReviewFindingPrismaRepository', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let repository: PrReviewFindingPrismaRepository;

  beforeEach(() => {
    prisma = buildPrisma();
    repository = new PrReviewFindingPrismaRepository(
      prisma as unknown as PrismaService,
    );
  });

  it('생성된 행을 도메인 레코드로 변환한다 (BigInt → string)', async () => {
    prisma.prReviewFinding.create.mockResolvedValue({
      id: 1,
      agentRunId: 7,
      repo: 'JSL107/personal_agents',
      pullNumber: 180,
      headSha: 'abc1234',
      category: 'RELIABILITY',
      severity: 'MUST_FIX',
      filePath: 'src/foo.service.ts',
      line: 42,
      body: '트랜잭션 밖에서 저장한다',
      fingerprint: 'fp-1',
      status: 'OPEN',
      postMode: 'INLINE',
      githubCommentId: BigInt(999),
      githubThreadNodeId: 'PRRC_comment',
      createdAt: new Date('2026-07-31T00:00:00Z'),
    });

    const created = await repository.createIfAbsent(createInput());

    expect(created?.githubCommentId).toBe('999');
    expect(created?.githubThreadNodeId).toBe('PRRC_comment');
    expect(created?.status).toBe('OPEN');
  });

  it('지문 중복(P2002)이면 null 을 반환한다', async () => {
    prisma.prReviewFinding.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.0.0',
      }),
    );

    const created = await repository.createIfAbsent(createInput());

    expect(created).toBeNull();
  });

  it('P2002 가 아닌 에러는 그대로 던진다', async () => {
    prisma.prReviewFinding.create.mockRejectedValue(new Error('connection'));

    await expect(repository.createIfAbsent(createInput())).rejects.toThrow(
      'connection',
    );
  });

  it('카드가 1건 이상이면 hasAnyForPullRequest 가 true', async () => {
    prisma.prReviewFinding.count.mockResolvedValue(3);

    const found = await repository.hasAnyForPullRequest({
      repo: 'JSL107/personal_agents',
      pullNumber: 180,
    });

    expect(found).toBe(true);
    expect(prisma.prReviewFinding.count).toHaveBeenCalledWith({
      where: { repo: 'JSL107/personal_agents', pullNumber: 180 },
    });
  });

  it('카드가 없으면 hasAnyForPullRequest 가 false', async () => {
    prisma.prReviewFinding.count.mockResolvedValue(0);

    const found = await repository.hasAnyForPullRequest({
      repo: 'JSL107/personal_agents',
      pullNumber: 181,
    });

    expect(found).toBe(false);
  });

  it('markPosted 는 게시 모드와 코멘트 id 를 갱신한다', async () => {
    prisma.prReviewFinding.update.mockResolvedValue({});

    await repository.markPosted({
      id: 1,
      postMode: 'FILE',
      githubCommentId: '999',
      githubThreadNodeId: 'PRRT_node',
    });

    expect(prisma.prReviewFinding.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        postMode: 'FILE',
        githubCommentId: BigInt(999),
        githubThreadNodeId: 'PRRT_node',
      },
    });
  });

  it('최근 미결 PR 20개를 고르고 선택한 PR의 OPEN 카드를 상한 없이 조회한다', async () => {
    prisma.prReviewFinding.groupBy
      .mockResolvedValueOnce([
        {
          repo: 'JSL107/personal_agents',
          pullNumber: 180,
          _max: { createdAt: new Date('2026-07-31T00:00:00Z') },
        },
      ])
      .mockResolvedValueOnce([
        { repo: 'JSL107/personal_agents', pullNumber: 180 },
      ]);
    prisma.prReviewFinding.findMany.mockResolvedValue([
      {
        id: 1,
        agentRunId: 7,
        repo: 'JSL107/personal_agents',
        pullNumber: 180,
        headSha: 'abc1234',
        category: 'RELIABILITY',
        severity: 'MUST_FIX',
        filePath: 'src/foo.service.ts',
        line: 42,
        body: '트랜잭션 밖에서 저장한다',
        fingerprint: 'fp-1',
        status: 'OPEN',
        postMode: 'INLINE',
        githubCommentId: BigInt(999),
        githubThreadNodeId: 'PRRC_comment',
        createdAt: new Date('2026-07-31T00:00:00Z'),
      },
      {
        id: 2,
        agentRunId: 8,
        repo: 'JSL107/personal_agents',
        pullNumber: 180,
        headSha: 'def5678',
        category: 'CORRECTNESS',
        severity: 'SHOULD_FIX',
        filePath: 'src/bar.service.ts',
        line: 10,
        body: '두 번째 카드',
        fingerprint: 'fp-2',
        status: 'OPEN',
        postMode: 'INLINE',
        githubCommentId: BigInt(1000),
        githubThreadNodeId: 'PRRC_comment_2',
        createdAt: new Date('2026-07-31T01:00:00Z'),
      },
    ]);

    const cards = await repository.findOpenPostedCards();

    const openThreadWhere = {
      status: 'OPEN',
      resolvedAt: null,
      githubCommentId: { not: null },
    };
    expect(prisma.prReviewFinding.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['repo', 'pullNumber'],
      where: openThreadWhere,
      _max: { createdAt: true },
      orderBy: [
        { _max: { createdAt: 'desc' } },
        { repo: 'asc' },
        { pullNumber: 'asc' },
      ],
      take: 20,
    });
    expect(prisma.prReviewFinding.findMany).toHaveBeenCalledWith({
      where: {
        ...openThreadWhere,
        OR: [{ repo: 'JSL107/personal_agents', pullNumber: 180 }],
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(cards).toHaveLength(2);
    expect(cards[0].githubThreadNodeId).toBe('PRRC_comment');
  });

  it('미결 PR이 20개를 넘으면 이번 회차에서 빠진 PR 수를 경고한다', async () => {
    const selectedPullRequests = Array.from({ length: 20 }, (_, index) => ({
      repo: 'JSL107/personal_agents',
      pullNumber: index + 1,
      _max: { createdAt: new Date(`2026-07-${30 - index}T00:00:00Z`) },
    }));
    const allPullRequests = Array.from({ length: 23 }, (_, index) => ({
      repo: 'JSL107/personal_agents',
      pullNumber: index + 1,
    }));
    prisma.prReviewFinding.groupBy
      .mockResolvedValueOnce(selectedPullRequests)
      .mockResolvedValueOnce(allPullRequests);
    prisma.prReviewFinding.findMany.mockResolvedValue([]);
    const warn = jest.spyOn(
      (
        repository as unknown as {
          logger: { warn: (message: string) => void };
        }
      ).logger,
      'warn',
    );

    await repository.findOpenPostedCards();

    expect(warn).toHaveBeenCalledWith(
      'PR 리뷰 수확 대상 PR 23건 중 최근 20건만 처리합니다. 이번 회차 제외: 3건.',
    );
  });

  it('markDecided는 결정 시각과 교정된 PRRT id를 저장한다', async () => {
    prisma.prReviewFinding.update.mockResolvedValue({});

    await repository.markDecided({
      id: 1,
      status: 'REJECTED',
      rejectReason: '지적이 틀림',
      githubThreadNodeId: 'PRRT_thread',
    });

    expect(prisma.prReviewFinding.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        status: 'REJECTED',
        rejectReason: '지적이 틀림',
        githubThreadNodeId: 'PRRT_thread',
        decidedAt: expect.any(Date),
      },
    });
  });

  it('ACKED 결정에는 rejectReason을 저장하지 않는다', async () => {
    prisma.prReviewFinding.update.mockResolvedValue({});

    await repository.markDecided({
      id: 1,
      status: 'ACKED',
      rejectReason: '잘못 전달된 값',
      githubThreadNodeId: 'PRRT_thread',
    });

    expect(prisma.prReviewFinding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rejectReason: null }),
      }),
    );
  });

  it.each(['ACKED', 'REJECTED'] as const)(
    'markThreadResolved 후에도 %s 결론을 덮어쓰지 않는다',
    async (status) => {
      prisma.prReviewFinding.update.mockResolvedValue({});

      await repository.markDecided({
        id: 1,
        status,
        rejectReason: status === 'REJECTED' ? '지적이 틀림' : null,
        githubThreadNodeId: 'PRRT_thread',
      });
      await repository.markThreadResolved(1);

      expect(prisma.prReviewFinding.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ status }),
        }),
      );
      expect(prisma.prReviewFinding.update).toHaveBeenNthCalledWith(2, {
        where: { id: 1 },
        data: { resolvedAt: expect.any(Date) },
      });
    },
  );

  it('카테고리·상태별 카드 수를 집계해 반환한다', async () => {
    prisma.prReviewFinding.groupBy.mockResolvedValue([
      { category: 'CORRECTNESS', status: 'ACKED', _count: { _all: 14 } },
      { category: 'CORRECTNESS', status: 'REJECTED', _count: { _all: 1 } },
    ]);

    const rows = await repository.countAdoptionByCategory();

    // 상태 필터는 순수 함수(summarizeAdoption)가 맡는다 — 여기서는 조합을 그대로 넘긴다.
    expect(prisma.prReviewFinding.groupBy).toHaveBeenCalledWith({
      by: ['category', 'status'],
      _count: { _all: true },
    });
    expect(rows).toEqual([
      { category: 'CORRECTNESS', status: 'ACKED', count: 14 },
      { category: 'CORRECTNESS', status: 'REJECTED', count: 1 },
    ]);
  });
});
