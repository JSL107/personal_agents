import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RecordReactionInput } from '../domain/port/reaction-signal.repository.port';
import { ReactionSignalPrismaRepository } from './reaction-signal.prisma.repository';

const recordInput = (): RecordReactionInput => ({
  slackUserId: 'U1',
  channelId: 'C1',
  messageTs: '1700000000.000100',
  emoji: '+1',
  messageText: '오늘 오전 브리핑 보냅니다',
});

const buildPrisma = () => ({
  slackReactionSignal: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
});

describe('ReactionSignalPrismaRepository', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let repository: ReactionSignalPrismaRepository;

  beforeEach(() => {
    prisma = buildPrisma();
    repository = new ReactionSignalPrismaRepository(
      prisma as unknown as PrismaService,
    );
  });

  it('record 는 입력을 그대로 create 에 전달한다', async () => {
    prisma.slackReactionSignal.create.mockResolvedValue({});

    await repository.record(recordInput());

    expect(prisma.slackReactionSignal.create).toHaveBeenCalledWith({
      data: recordInput(),
    });
  });

  // 다이제스트 카드는 수천 자다. 신호로 쓰는 건 앞 300자뿐이라, 상한이 없으면 쓰지 않는
  // 본문이 테이블을 채운다.
  it('메시지 본문이 1,000자를 넘으면 잘라서 저장한다', async () => {
    prisma.slackReactionSignal.create.mockResolvedValue({});

    await repository.record({
      ...recordInput(),
      messageText: '가'.repeat(1_500),
    });

    const [{ data }] = prisma.slackReactionSignal.create.mock.calls[0] as [
      { data: { messageText: string } },
    ];
    expect(data.messageText).toHaveLength(1_000);
  });

  it('중복 반응(P2002)이 예외로 새지 않는다', async () => {
    prisma.slackReactionSignal.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.0.0',
      }),
    );

    await expect(repository.record(recordInput())).resolves.toBeUndefined();
  });

  it('P2002 가 아닌 에러는 그대로 던진다', async () => {
    prisma.slackReactionSignal.create.mockRejectedValue(
      new Error('connection'),
    );

    await expect(repository.record(recordInput())).rejects.toThrow(
      'connection',
    );
  });

  it('recentReactions 는 owner 의 반응을 결정 시각 내림차순으로 조회한다', async () => {
    prisma.slackReactionSignal.findMany.mockResolvedValue([
      { id: 2, emoji: '-1', messageText: '두 번째' },
      { id: 1, emoji: '+1', messageText: '첫 번째' },
    ]);
    const sinceMs = 1_700_000_000_000;

    const rows = await repository.recentReactions('U1', sinceMs);

    expect(prisma.slackReactionSignal.findMany).toHaveBeenCalledWith({
      where: { slackUserId: 'U1', createdAt: { gte: new Date(sinceMs) } },
      orderBy: { createdAt: 'desc' },
      // 창 안의 전건을 메모리로 올리지 않는다 — 형제 신호원(preview_decision)의 FETCH_LIMIT 과 같은 자리.
      take: 500,
    });
    expect(rows).toEqual([
      { id: 2, emoji: '-1', messageText: '두 번째' },
      { id: 1, emoji: '+1', messageText: '첫 번째' },
    ]);
  });

  it('반응 이력이 없으면 빈 배열을 반환한다', async () => {
    prisma.slackReactionSignal.findMany.mockResolvedValue([]);
    const rows = await repository.recentReactions('U1', 0);
    expect(rows).toEqual([]);
  });
});
