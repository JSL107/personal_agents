import { utcMidnightOf } from '../../common/util/kst-date.util';
import { MissionResult } from '../domain/port/saju-fortune-day.repository.port';
import { SajuFortuneDayPrismaRepository } from './saju-fortune-day.prisma.repository';

const repositoryWith = (delegate: Record<string, jest.Mock>) =>
  new SajuFortuneDayPrismaRepository({ sajuFortuneDay: delegate } as never);

describe('SajuFortuneDayPrismaRepository', () => {
  it('recordSent 는 사람·날짜 유니크 키로 upsert 하고 카드가 없으면 두 칸을 null 로 쓴다', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);

    await repositoryWith({ upsert }).recordSent({
      slackUserId: 'U1',
      fortuneDate: '2026-11-10',
      missionKey: 'work-wood-1',
      missionText: '책상 정리',
      aiBody: '본문',
    });

    const [argument] = upsert.mock.calls[0];
    expect(argument.where).toEqual({
      slackUserId_fortuneDate: {
        slackUserId: 'U1',
        fortuneDate: utcMidnightOf('2026-11-10'),
      },
    });
    expect(argument.create).toMatchObject({
      cardTitle: null,
      cardThumbnail: null,
    });
    expect(argument.update).toMatchObject({
      missionKey: 'work-wood-1',
      cardTitle: null,
      cardThumbnail: null,
    });
  });

  it('recordSent 는 카드가 있으면 제목과 썸네일을 함께 쓴다', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const thumbnail = Buffer.from([1, 2, 3]);

    await repositoryWith({ upsert }).recordSent({
      slackUserId: 'U1',
      fortuneDate: '2026-11-10',
      missionKey: 'work-wood-1',
      missionText: '책상 정리',
      aiBody: '본문',
      card: { title: 'THE RIVER', thumbnail },
    });

    const { create } = upsert.mock.calls[0][0];
    expect(create.cardTitle).toBe('THE RIVER');
    expect(Array.from(create.cardThumbnail)).toEqual([1, 2, 3]);
  });

  it('findRecentMissionKeys 는 before 이전 days 일만 날짜 내림차순으로 본다', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { missionKey: 'a', fortuneDate: utcMidnightOf('2026-11-09') },
      ]);

    const recent = await repositoryWith({ findMany }).findRecentMissionKeys({
      slackUserId: 'U1',
      before: '2026-11-10',
      days: 14,
    });

    expect(recent).toEqual([{ missionKey: 'a', fortuneDate: '2026-11-09' }]);
    const [argument] = findMany.mock.calls[0];
    expect(argument.where).toEqual({
      slackUserId: 'U1',
      fortuneDate: {
        gte: utcMidnightOf('2026-10-27'),
        lt: utcMidnightOf('2026-11-10'),
      },
    });
    expect(argument.orderBy).toEqual({ fortuneDate: 'desc' });
  });

  it('findMissionDay 는 본문·썸네일을 읽지 않는다', async () => {
    const createdAt = new Date('2026-11-10T00:00:00Z');
    const findUnique = jest.fn().mockResolvedValue({
      fortuneDate: utcMidnightOf('2026-11-10'),
      missionText: '책상 정리',
      missionResult: 'done',
      createdAt,
    });

    const day = await repositoryWith({ findUnique }).findMissionDay({
      slackUserId: 'U1',
      fortuneDate: '2026-11-10',
    });

    expect(day).toEqual({
      fortuneDate: '2026-11-10',
      missionText: '책상 정리',
      missionResult: MissionResult.DONE,
      createdAt,
    });
    const { select } = findUnique.mock.calls[0][0];
    expect(select.aiBody).toBeUndefined();
    expect(select.cardThumbnail).toBeUndefined();
  });

  it('findMissionDay 는 행이 없으면 undefined', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);

    const day = await repositoryWith({ findUnique }).findMissionDay({
      slackUserId: 'U1',
      fortuneDate: '2026-11-10',
    });

    expect(day).toBeUndefined();
  });

  it('answerMission 은 행이 없으면 false', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });

    const answered = await repositoryWith({ updateMany }).answerMission({
      slackUserId: 'U1',
      fortuneDate: '2026-11-10',
      result: MissionResult.DONE,
    });

    expect(answered).toBe(false);
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      missionResult: 'done',
    });
  });

  it('countWeekDone 은 월요일부터 일요일까지 done 만 센다', async () => {
    const count = jest.fn().mockResolvedValue(3);

    const done = await repositoryWith({ count }).countWeekDone({
      slackUserId: 'U1',
      monday: '2026-11-09',
    });

    expect(done).toBe(3);
    expect(count.mock.calls[0][0].where).toEqual({
      slackUserId: 'U1',
      missionResult: 'done',
      fortuneDate: {
        gte: utcMidnightOf('2026-11-09'),
        lte: utcMidnightOf('2026-11-15'),
      },
    });
  });

  it('findMonthCards 는 썸네일 있는 행만 날짜순으로 날짜·썸네일만 고른다', async () => {
    const thumbnail = Buffer.from([9]);
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { fortuneDate: utcMidnightOf('2026-11-01'), cardThumbnail: thumbnail },
      ]);

    const cards = await repositoryWith({ findMany }).findMonthCards({
      slackUserId: 'U1',
      month: '2026-11',
    });

    expect(cards).toEqual([{ fortuneDate: '2026-11-01', thumbnail }]);
    const [argument] = findMany.mock.calls[0];
    expect(argument.where).toEqual({
      slackUserId: 'U1',
      cardThumbnail: { not: null },
      fortuneDate: {
        gte: utcMidnightOf('2026-11-01'),
        lt: utcMidnightOf('2026-12-01'),
      },
    });
    expect(argument.orderBy).toEqual({ fortuneDate: 'asc' });
    expect(argument.select).toEqual({ fortuneDate: true, cardThumbnail: true });
  });

  it('findMonthCards 는 12월 다음 달을 이듬해 1월로 계산한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);

    await repositoryWith({ findMany }).findMonthCards({
      slackUserId: 'U1',
      month: '2026-12',
    });

    expect(findMany.mock.calls[0][0].where.fortuneDate).toEqual({
      gte: utcMidnightOf('2026-12-01'),
      lt: utcMidnightOf('2027-01-01'),
    });
  });
});
