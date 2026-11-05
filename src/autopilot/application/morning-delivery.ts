import { Logger } from '@nestjs/common';

import { kstDayStartOf } from '../../common/util/kst-date.util';
import { AgentType } from '../../model-router/domain/model-router.type';
import { SlackDeliveryRepositoryPort } from '../../slack/domain/port/slack-delivery.repository.port';
import { isRunResultDelivered } from '../domain/run-delivery';

const DAY_MS = 24 * 60 * 60 * 1000;
const logger = new Logger('MorningDelivery');

interface FindMorningDeliveredInput {
  deliveryRepository: SlackDeliveryRepositoryPort;
  firedAtKst: string;
}

export const findMorningDelivered = async ({
  deliveryRepository,
  firedAtKst,
}: FindMorningDeliveredInput): Promise<boolean | null> => {
  const dayStart = kstDayStartOf(firedAtKst);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  try {
    const deliveries = await deliveryRepository.findSince(dayStart, dayEnd);
    return isRunResultDelivered({ agentType: AgentType.PM, deliveries });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`아침 발송 기록 조회 실패: ${message}`);
    return null;
  }
};
