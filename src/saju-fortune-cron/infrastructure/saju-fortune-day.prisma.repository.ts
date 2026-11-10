import { Injectable } from '@nestjs/common';

import { addDaysTo, utcMidnightOf } from '../../common/util/kst-date.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MissionDay,
  MissionResult,
  MonthCard,
  RecentMission,
  SajuFortuneDayKey,
  SajuFortuneDayRepositoryPort,
  SentFortuneDay,
} from '../domain/port/saju-fortune-day.repository.port';

const DAYS_PER_WEEK = 7;

// @db.Date 값은 그날 UTC 00:00 으로 온다 — 앞 10자리가 곧 날짜다.
const dateStringOf = (date: Date): string => date.toISOString().slice(0, 10);

const uniqueKeyOf = ({ slackUserId, fortuneDate }: SajuFortuneDayKey) => ({
  slackUserId_fortuneDate: {
    slackUserId,
    fortuneDate: utcMidnightOf(fortuneDate),
  },
});

// 'YYYY-MM' 의 다음 달 1일.
const nextMonthStartOf = (month: string): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  const nextMonthStart = dateStringOf(next);
  return nextMonthStart;
};

const missionResultOf = (value: string | null): MissionResult | undefined =>
  Object.values(MissionResult).find((result) => result === value);

@Injectable()
export class SajuFortuneDayPrismaRepository implements SajuFortuneDayRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async recordSent({
    slackUserId,
    fortuneDate,
    missionKey,
    missionText,
    aiBody,
    card,
  }: SentFortuneDay): Promise<void> {
    // 재발송(Slack 응답 유실 뒤 재시도)이면 나중에 나간 것으로 덮는다. 이전 답은 그대로 둔다.
    const content = {
      missionKey,
      missionText,
      aiBody,
      cardTitle: card?.title ?? null,
      // Prisma Bytes 는 ArrayBuffer 기반 Uint8Array 만 받는다 — Buffer 를 그대로 넣으면 타입이 맞지 않는다.
      cardThumbnail: card ? Uint8Array.from(card.thumbnail) : null,
    };
    await this.prisma.sajuFortuneDay.upsert({
      where: uniqueKeyOf({ slackUserId, fortuneDate }),
      create: {
        slackUserId,
        fortuneDate: utcMidnightOf(fortuneDate),
        ...content,
      },
      update: content,
    });
  }

  async findRecentMissionKeys({
    slackUserId,
    before,
    days,
  }: {
    slackUserId: string;
    before: string;
    days: number;
  }): Promise<RecentMission[]> {
    const rows = await this.prisma.sajuFortuneDay.findMany({
      where: {
        slackUserId,
        fortuneDate: {
          gte: utcMidnightOf(addDaysTo(before, -days)),
          lt: utcMidnightOf(before),
        },
      },
      orderBy: { fortuneDate: 'desc' },
      select: { missionKey: true, fortuneDate: true },
    });
    const recent = rows.map(({ missionKey, fortuneDate }) => ({
      missionKey,
      fortuneDate: dateStringOf(fortuneDate),
    }));
    return recent;
  }

  async findMissionDay(
    key: SajuFortuneDayKey,
  ): Promise<MissionDay | undefined> {
    const row = await this.prisma.sajuFortuneDay.findUnique({
      where: uniqueKeyOf(key),
      select: {
        fortuneDate: true,
        missionText: true,
        missionResult: true,
        createdAt: true,
      },
    });
    if (!row) {
      return undefined;
    }
    const day: MissionDay = {
      fortuneDate: dateStringOf(row.fortuneDate),
      missionText: row.missionText,
      missionResult: missionResultOf(row.missionResult),
      createdAt: row.createdAt,
    };
    return day;
  }

  async answerMission({
    slackUserId,
    fortuneDate,
    result,
  }: SajuFortuneDayKey & { result: MissionResult }): Promise<boolean> {
    const { count } = await this.prisma.sajuFortuneDay.updateMany({
      where: { slackUserId, fortuneDate: utcMidnightOf(fortuneDate) },
      data: { missionResult: result, missionAnsweredAt: new Date() },
    });
    const answered = count > 0;
    return answered;
  }

  countWeekDone({
    slackUserId,
    monday,
  }: {
    slackUserId: string;
    monday: string;
  }): Promise<number> {
    return this.prisma.sajuFortuneDay.count({
      where: {
        slackUserId,
        missionResult: MissionResult.DONE,
        fortuneDate: {
          gte: utcMidnightOf(monday),
          lte: utcMidnightOf(addDaysTo(monday, DAYS_PER_WEEK - 1)),
        },
      },
    });
  }

  async findMonthCards({
    slackUserId,
    month,
  }: {
    slackUserId: string;
    month: string;
  }): Promise<MonthCard[]> {
    const rows = await this.prisma.sajuFortuneDay.findMany({
      where: {
        slackUserId,
        cardThumbnail: { not: null },
        fortuneDate: {
          gte: utcMidnightOf(`${month}-01`),
          lt: utcMidnightOf(nextMonthStartOf(month)),
        },
      },
      orderBy: { fortuneDate: 'asc' },
      select: { fortuneDate: true, cardThumbnail: true },
    });
    const cards = rows.flatMap(({ fortuneDate, cardThumbnail }) =>
      cardThumbnail
        ? [
            {
              fortuneDate: dateStringOf(fortuneDate),
              thumbnail: Buffer.from(cardThumbnail),
            },
          ]
        : [],
    );
    return cards;
  }
}
