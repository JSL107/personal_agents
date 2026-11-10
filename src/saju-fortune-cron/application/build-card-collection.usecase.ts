import { Inject, Injectable } from '@nestjs/common';

import {
  CARD_COLLAGE_PORT,
  CardCollagePort,
} from '../domain/port/card-collage.port';
import {
  SAJU_FORTUNE_DAY_REPOSITORY_PORT,
  SajuFortuneDayKey,
  SajuFortuneDayRepositoryPort,
} from '../domain/port/saju-fortune-day.repository.port';
import { monthPeriodOf } from '../domain/saju-fortune-period';

export interface CardCollection {
  png: Buffer;
  // 1~12.
  month: number;
  count: number;
}

// 그 날짜가 속한 달에 받은 카드를 격자 한 장으로 모은다. 카드가 없으면 undefined.
@Injectable()
export class BuildCardCollectionUsecase {
  constructor(
    @Inject(SAJU_FORTUNE_DAY_REPOSITORY_PORT)
    private readonly fortuneDays: SajuFortuneDayRepositoryPort,
    @Inject(CARD_COLLAGE_PORT)
    private readonly cardCollage: CardCollagePort,
  ) {}

  async build({
    slackUserId,
    fortuneDate,
  }: SajuFortuneDayKey): Promise<CardCollection | undefined> {
    const cards = await this.fortuneDays.findCards({
      slackUserId,
      period: monthPeriodOf({ date: fortuneDate }),
    });
    if (cards.length === 0) {
      return undefined;
    }
    const collection: CardCollection = {
      png: await this.cardCollage.renderCards(cards),
      month: Number(fortuneDate.slice(5, 7)),
      count: cards.length,
    };
    return collection;
  }
}
