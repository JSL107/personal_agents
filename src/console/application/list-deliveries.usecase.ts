import { Inject, Injectable } from '@nestjs/common';

import {
  SLACK_DELIVERY_REPOSITORY,
  SlackDeliveryListRow,
  SlackDeliveryRepositoryPort,
} from '../../slack/domain/port/slack-delivery.repository.port';
import { SlackDeliveryStatus } from '../../slack/domain/slack-delivery.type';
import {
  clampDeliveryListLimit,
  clampDeliveryWindowDays,
} from '../../slack/domain/slack-delivery-summary';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type ListDeliveriesInput = {
  status: SlackDeliveryStatus;
  days: number;
  limit: number;
};

export type ListDeliveriesResult = {
  status: SlackDeliveryStatus;
  days: number;
  limit: number;
  items: SlackDeliveryListRow[];
};

@Injectable()
export class ListDeliveriesUsecase {
  constructor(
    @Inject(SLACK_DELIVERY_REPOSITORY)
    private readonly repository: SlackDeliveryRepositoryPort,
  ) {}

  async execute(input: ListDeliveriesInput): Promise<ListDeliveriesResult> {
    const days = clampDeliveryWindowDays(input.days);
    const limit = clampDeliveryListLimit(input.limit);
    const since = new Date(Date.now() - days * MILLISECONDS_PER_DAY);
    const items = await this.repository.findByStatus({
      status: input.status,
      since,
      limit,
    });
    return { status: input.status, days, limit, items };
  }
}
