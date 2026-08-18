import { PrismaService } from '../../../prisma/prisma.service';
import { CareerTargetJdPrismaRepository } from './career-target-jd.prisma.repository';

describe('CareerTargetJdPrismaRepository', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('목표 공고를 Prisma create 입력으로 저장한다', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1 });
    const prisma = { careerTargetJd: { create } } as unknown as PrismaService;
    const repository = new CareerTargetJdPrismaRepository(prisma);

    await repository.save({
      slackUserId: 'U1',
      company: '이대리',
      role: '백엔드',
      jdText: 'NestJS 필수',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        slackUserId: 'U1',
        company: '이대리',
        role: '백엔드',
        jdText: 'NestJS 필수',
      },
    });
  });

  it('30일 경계를 포함해 최신 공고 한 건을 조회한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-18T00:00:00.000Z'));
    const createdAt = new Date('2026-07-19T00:00:00.000Z');
    const findFirst = jest.fn().mockResolvedValue({
      id: 7,
      company: '이대리',
      role: '백엔드',
      jdText: 'NestJS 필수',
      createdAt,
    });
    const prisma = {
      careerTargetJd: { findFirst },
    } as unknown as PrismaService;
    const repository = new CareerTargetJdPrismaRepository(prisma);

    const result = await repository.findActiveBySlackUser('U1', 30);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        slackUserId: 'U1',
        createdAt: { gte: new Date('2026-07-19T00:00:00.000Z') },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual({
      id: 7,
      company: '이대리',
      role: '백엔드',
      jdText: 'NestJS 필수',
      createdAt,
    });
  });

  it('30일보다 오래된 공고가 없으면 null을 반환한다', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      careerTargetJd: { findFirst },
    } as unknown as PrismaService;
    const repository = new CareerTargetJdPrismaRepository(prisma);

    await expect(
      repository.findActiveBySlackUser('U1', 30),
    ).resolves.toBeNull();
  });
});
