import { PrismaService } from '../../prisma/prisma.service';
import { PaperTradingPrismaRepository } from '../infrastructure/paper-trading.prisma.repository';
import { OpenPaperAccountUsecase } from './open-paper-account.usecase';

const createFixture = (input?: {
  existingAccount?: { id: number } | null;
  createError?: unknown;
}) => {
  const prisma = {
    paperAccount: {
      findUnique: jest.fn().mockResolvedValue(input?.existingAccount ?? null),
      create: input?.createError
        ? jest.fn().mockRejectedValue(input.createError)
        : jest.fn().mockResolvedValue({ id: 41 }),
    },
  };
  const repository = new PaperTradingPrismaRepository(
    prisma as unknown as PrismaService,
  );
  return {
    usecase: new OpenPaperAccountUsecase(repository),
    prisma,
  };
};

describe('OpenPaperAccountUsecase', () => {
  it('계좌를 시드와 같은 현금 잔액으로 개설한다', async () => {
    const { usecase, prisma } = createFixture();
    const openedAt = new Date('2026-08-11T08:00:00.000Z');

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      seedAmount: '10000000',
      openedAt,
    });

    expect(result).toEqual({
      accountId: 41,
      seedAmount: '10000000',
      cashBalance: '10000000',
    });
    expect(prisma.paperAccount.create).toHaveBeenCalledWith({
      data: {
        name: 'DEFAULT',
        currency: 'KRW',
        seedAmount: '10000000',
        cashBalance: '10000000',
        openedAt,
      },
      select: { id: true },
    });
  });

  it('같은 이름의 계좌가 이미 있으면 개설을 거부한다', async () => {
    const { usecase, prisma } = createFixture({ existingAccount: { id: 7 } });

    await expect(
      usecase.execute({
        accountName: 'DEFAULT',
        seedAmount: '10000000',
        openedAt: new Date('2026-08-11T08:00:00.000Z'),
      }),
    ).rejects.toThrow('같은 이름의 가상 매매 계좌가 이미 있습니다: DEFAULT');
    expect(prisma.paperAccount.create).not.toHaveBeenCalled();
  });

  it.each(['0', '-1'])('시드가 %s이면 개설을 거부한다', async (seedAmount) => {
    const { usecase, prisma } = createFixture();

    await expect(
      usecase.execute({
        accountName: 'DEFAULT',
        seedAmount,
        openedAt: new Date('2026-08-11T08:00:00.000Z'),
      }),
    ).rejects.toThrow('가상 매매 시드는 0보다 커야 합니다.');
    expect(prisma.paperAccount.findUnique).not.toHaveBeenCalled();
    expect(prisma.paperAccount.create).not.toHaveBeenCalled();
  });

  it('조회 후 생성 사이에 P2002가 발생해도 중복 계좌 오류로 변환한다', async () => {
    const { usecase } = createFixture({
      createError: { code: 'P2002', meta: { target: ['name'] } },
    });

    await expect(
      usecase.execute({
        accountName: 'DEFAULT',
        seedAmount: '10000000',
        openedAt: new Date('2026-08-11T08:00:00.000Z'),
      }),
    ).rejects.toThrow('같은 이름의 가상 매매 계좌가 이미 있습니다: DEFAULT');
  });
});
