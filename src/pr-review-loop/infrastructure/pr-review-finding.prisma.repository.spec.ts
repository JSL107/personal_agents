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
      createdAt: new Date('2026-07-31T00:00:00Z'),
    });

    const created = await repository.createIfAbsent(createInput());

    expect(created?.githubCommentId).toBe('999');
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
});
