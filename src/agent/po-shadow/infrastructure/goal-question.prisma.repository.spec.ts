import { GoalQuestionPrismaRepository } from './goal-question.prisma.repository';

const makePrisma = () => ({
  goalQuestion: {
    create: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
});

describe('GoalQuestionPrismaRepository', () => {
  const now = new Date('2026-10-27T00:15:00.000Z');
  const row = {
    id: 1,
    slackUserId: 'U1',
    expiresAt: new Date('2026-10-30T00:15:00.000Z'),
    previewId: null,
    criterionAskedAt: null,
    pendingDraft: null,
    closedAt: null,
    closeReason: null,
    createdAt: now,
  };

  it('열린 질문 중 유효한 최신 한 건만 찾는다', async () => {
    const prisma = makePrisma();
    prisma.goalQuestion.findFirst.mockResolvedValue(row);
    const repository = new GoalQuestionPrismaRepository(prisma as never);

    expect(await repository.findOpen({ slackUserId: 'U1', now })).toEqual(row);
    expect(prisma.goalQuestion.findFirst).toHaveBeenCalledWith({
      where: { slackUserId: 'U1', closedAt: null, expiresAt: { gt: now } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('카드와 되묻기 초안을 열린 질문에만 연결한다', async () => {
    const prisma = makePrisma();
    const repository = new GoalQuestionPrismaRepository(prisma as never);
    const pendingDraft = {
      kind: 'TASK' as const,
      title: '제품 출시',
      why: null,
      successCriterion: null,
      keywords: [],
      dueDate: null,
    };

    await repository.markCriterionAsked({ id: 1, at: now, pendingDraft });
    await repository.attachPreview({ id: 1, previewId: 'preview-1' });

    expect(prisma.goalQuestion.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 1, closedAt: null },
      data: { criterionAskedAt: now, pendingDraft },
    });
    expect(prisma.goalQuestion.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 1, closedAt: null },
      data: { previewId: 'preview-1', pendingDraft: expect.anything() },
    });
  });

  it('닫힌 질문은 다시 닫지 않는다', async () => {
    const prisma = makePrisma();
    const repository = new GoalQuestionPrismaRepository(prisma as never);

    await repository.close({ id: 1, reason: 'DECLINED', at: now });

    expect(prisma.goalQuestion.updateMany).toHaveBeenCalledWith({
      where: { id: 1, closedAt: null },
      data: { closedAt: now, closeReason: 'DECLINED' },
    });
  });

  it('질문 생성 시 owner와 만료 시각을 저장한다', async () => {
    const prisma = makePrisma();
    prisma.goalQuestion.create.mockResolvedValue(row);
    const repository = new GoalQuestionPrismaRepository(prisma as never);

    expect(
      await repository.create({ slackUserId: 'U1', expiresAt: row.expiresAt }),
    ).toEqual(row);
    expect(prisma.goalQuestion.create).toHaveBeenCalledWith({
      data: { slackUserId: 'U1', expiresAt: row.expiresAt },
    });
  });
});
