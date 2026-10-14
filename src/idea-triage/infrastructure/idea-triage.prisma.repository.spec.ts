import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateIdeaTriageInput } from '../domain/port/idea-triage.repository.port';
import { IdeaTriagePrismaRepository } from './idea-triage.prisma.repository';

const input: CreateIdeaTriageInput = {
  channelId: 'C1',
  messageTs: '1.1',
  authorSlackUserId: 'U1',
  ideaText: '본문',
  verdict: 'BUILD',
  reason: '이유',
  counterpoint: '반박',
  scheduleTitle: '개발',
  effort: 'S',
  proposedDate: { year: 2026, month: 10, day: 16 },
  agentRunId: 4,
};

const createPrisma = () => ({
  ideaTriage: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
});

describe('IdeaTriagePrismaRepository', () => {
  it('생성 시 UTC 날짜와 JUDGED 상태를 저장한다', async () => {
    const prisma = createPrisma();
    prisma.ideaTriage.create.mockResolvedValue({
      ...input,
      id: 3,
      proposedDate: new Date('2026-10-16T00:00:00Z'),
      status: 'JUDGED',
      replyTs: null,
      previewId: null,
      scheduleItemId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const repository = new IdeaTriagePrismaRepository(
      prisma as unknown as PrismaService,
    );
    const result = await repository.create(input);
    expect(prisma.ideaTriage.create).toHaveBeenCalledWith({
      data: {
        ...input,
        proposedDate: new Date('2026-10-16T00:00:00Z'),
        status: 'JUDGED',
      },
    });
    expect(result?.proposedDate).toEqual(input.proposedDate);
  });

  it('unique 충돌만 동시 실행 skip 신호인 null로 바꾼다', async () => {
    const prisma = createPrisma();
    prisma.ideaTriage.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6',
      }),
    );
    const repository = new IdeaTriagePrismaRepository(
      prisma as unknown as PrismaService,
    );
    await expect(repository.create(input)).resolves.toBeNull();
    prisma.ideaTriage.create.mockRejectedValue(new Error('connection lost'));
    await expect(repository.create(input)).rejects.toThrow('connection lost');
  });

  it('미게시 재시도는 현재 채널의 JUDGED 행만 조회한다', async () => {
    const prisma = createPrisma();
    prisma.ideaTriage.findMany.mockResolvedValue([]);
    const repository = new IdeaTriagePrismaRepository(
      prisma as unknown as PrismaService,
    );
    await repository.findUnposted('C1');
    expect(prisma.ideaTriage.findMany).toHaveBeenCalledWith({
      where: { channelId: 'C1', status: 'JUDGED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('게시 단계별 좌표를 JUDGED 상태 전이 없이 기록한다', async () => {
    const prisma = createPrisma();
    const repository = new IdeaTriagePrismaRepository(
      prisma as unknown as PrismaService,
    );
    await repository.markReplySent(3, '2.2');
    await repository.markPreviewCreated(3, 'preview-1');
    expect(prisma.ideaTriage.update).toHaveBeenNthCalledWith(1, {
      where: { id: 3 },
      data: { replyTs: '2.2' },
    });
    expect(prisma.ideaTriage.update).toHaveBeenNthCalledWith(2, {
      where: { id: 3 },
      data: { previewId: 'preview-1' },
    });
  });
});
