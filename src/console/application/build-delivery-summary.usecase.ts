import { Inject, Injectable } from '@nestjs/common';

import {
  SLACK_DELIVERY_REPOSITORY,
  SlackDeliveryRepositoryPort,
} from '../../slack/domain/port/slack-delivery.repository.port';
import {
  clampDeliveryWindowDays,
  SlackDeliverySummary,
  summarizeDeliveries,
} from '../../slack/domain/slack-delivery-summary';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class BuildDeliverySummaryUsecase {
  constructor(
    @Inject(SLACK_DELIVERY_REPOSITORY)
    private readonly repository: SlackDeliveryRepositoryPort,
  ) {}

  async execute(days: number): Promise<SlackDeliverySummary> {
    const windowDays = clampDeliveryWindowDays(days);
    const since = new Date(Date.now() - windowDays * MILLISECONDS_PER_DAY);
    const rows = await this.repository.findSince(since);
    return summarizeDeliveries(rows, { days: windowDays });
  }
}
