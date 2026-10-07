import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  RecordSlackDeliveryInput,
  SlackDeliveryRepositoryPort,
} from '../domain/port/slack-delivery.repository.port';

@Injectable()
export class SlackDeliveryPrismaRepository implements SlackDeliveryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordSlackDeliveryInput): Promise<void> {
    await this.prisma.slackDelivery.create({ data: input });
  }
}
