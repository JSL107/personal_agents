import { ConfigService } from '@nestjs/config';

import { ArtJobFeedCronJobData } from '../domain/art-job-feed-cron.type';

export const readArtJobFeedConfig = (
  configService: ConfigService,
  key: string,
): string | null => {
  const raw = configService.get<string>(key);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
};

export const readArtJobFeedJobData = (
  configService: ConfigService,
): ArtJobFeedCronJobData | null => {
  const target = readArtJobFeedConfig(configService, 'ART_JOB_FEED_TARGET');
  if (!target) {
    return null;
  }
  return {
    target,
    mentionUserId: readArtJobFeedConfig(
      configService,
      'ART_JOB_FEED_MENTION_USER_ID',
    ),
    ownerSlackUserId: readArtJobFeedConfig(
      configService,
      'AUTOPILOT_OWNER_SLACK_USER_ID',
    ),
  };
};
