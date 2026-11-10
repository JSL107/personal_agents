import { Injectable } from '@nestjs/common';

import { utcMidnightOf } from '../../common/util/kst-date.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CollectedCard,
  MissionAnswer,
  MissionDay,
  MissionResult,
  PeriodQuery,
  RecentMission,
  SajuFortuneDayKey,
  SajuFortuneDayRepositoryPort,
  SentFortuneDay,
} from '../domain/port/saju-fortune-day.repository.port';
import { DatePeriod } from '../domain/saju-fortune-period';

// @db.Date 값은 그날 UTC 00:00 으로 온다 — 앞 10자리가 곧 날짜다.
const dateStringOf = (date: Date): string => date.toISOString().slice(0, 10);

const uniqueKeyOf = ({ slackUserId, fortuneDate }: SajuFortuneDayKey) => ({
  slackUserId_fortuneDate: {
    slackUserId,
    fortuneDate: utcMidnightOf(fortuneDate),
  },
});

const fortuneDateIn = ({ from, until }: DatePeriod) => ({
  gte: utcMidnightOf(from),
  lt: utcMidnightOf(until),
});

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

  async findMissionKeys({
    slackUserId,
    period,
  }: PeriodQuery): Promise<RecentMission[]> {
    const rows = await this.prisma.sajuFortuneDay.findMany({
      where: {
        slackUserId,
        fortuneDate: fortuneDateIn(period),
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
  }: MissionAnswer): Promise<boolean> {
    const { count } = await this.prisma.sajuFortuneDay.updateMany({
      where: { slackUserId, fortuneDate: utcMidnightOf(fortuneDate) },
      data: { missionResult: result, missionAnsweredAt: new Date() },
    });
    const answered = count > 0;
    return answered;
  }

  countDone({ slackUserId, period }: PeriodQuery): Promise<number> {
    return this.prisma.sajuFortuneDay.count({
      where: {
        slackUserId,
        missionResult: MissionResult.DONE,
        fortuneDate: fortuneDateIn(period),
      },
    });
  }

  async findCards({
    slackUserId,
    period,
  }: PeriodQuery): Promise<CollectedCard[]> {
    const rows = await this.prisma.sajuFortuneDay.findMany({
      where: {
        slackUserId,
        cardThumbnail: { not: null },
        fortuneDate: fortuneDateIn(period),
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
