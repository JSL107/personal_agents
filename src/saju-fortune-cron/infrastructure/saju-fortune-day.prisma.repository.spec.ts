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

  it('findMissionKeys 는 받은 기간만 날짜 내림차순으로 본다', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { missionKey: 'a', fortuneDate: utcMidnightOf('2026-11-09') },
      ]);

    const recent = await repositoryWith({ findMany }).findMissionKeys({
      slackUserId: 'U1',
      period: { from: '2026-10-27', until: '2026-11-10' },
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

  it('countDone 은 받은 기간의 done 만 센다', async () => {
    const count = jest.fn().mockResolvedValue(3);

    const done = await repositoryWith({ count }).countDone({
      slackUserId: 'U1',
      period: { from: '2026-11-09', until: '2026-11-16' },
    });

    expect(done).toBe(3);
    expect(count.mock.calls[0][0].where).toEqual({
      slackUserId: 'U1',
      missionResult: 'done',
      fortuneDate: {
        gte: utcMidnightOf('2026-11-09'),
        lt: utcMidnightOf('2026-11-16'),
      },
    });
  });

  it('findCards 는 받은 기간에서 썸네일 있는 행만 날짜순으로 날짜·썸네일만 고른다', async () => {
    const thumbnail = Buffer.from([9]);
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { fortuneDate: utcMidnightOf('2026-11-01'), cardThumbnail: thumbnail },
      ]);

    const cards = await repositoryWith({ findMany }).findCards({
      slackUserId: 'U1',
      period: { from: '2026-11-01', until: '2026-12-01' },
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
});
