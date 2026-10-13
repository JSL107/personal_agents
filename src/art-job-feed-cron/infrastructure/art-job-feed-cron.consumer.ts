import { Processor } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  ArtJobListing,
  ResolvedArtJobImage,
} from '../../art-job-feed/domain/art-job-feed.type';
import { isTargetArtRole } from '../../art-job-feed/domain/art-role.filter';
import {
  ART_JOB_SOURCE_PORT,
  ArtJobSourcePort,
  GAME_IMAGE_RESOLVER_PORT,
  GameImageResolverPort,
  IMAGE_DOWNLOADER_PORT,
  ImageDownloaderPort,
} from '../../art-job-feed/domain/port/art-job-feed.ports';
import {
  ART_JOB_POSTING_REPOSITORY_PORT,
  ArtJobPostingRepositoryPort,
} from '../../art-job-feed/domain/port/art-job-posting.repository.port';
import {
  formatArtJobHeader,
  formatArtJobPosting,
} from '../../art-job-feed/infrastructure/art-job-feed.formatter';
import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { ObservedWorkerHost } from '../../common/queue/observed-worker-host';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { cronIncidentKey } from '../../notification/domain/notification.type';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../slack/domain/port/slack-notifier.port';
import {
  ART_JOB_FEED_CRON_QUEUE,
  ArtJobFeedCronJobData,
  LIST_PAGES_PER_RUN,
  MAX_POSTINGS_PER_RUN,
} from '../domain/art-job-feed-cron.type';

const CRON_NAME = 'Art Job Feed Cron';
const INCIDENT_KEY = cronIncidentKey(CRON_NAME);
// 한 슬롯(09시·18시) 안에서만 막으면 된다 — 다음 슬롯 전에 만료되도록 9시간 미만.
const SLOT_GUARD_TTL_SECONDS = 6 * 60 * 60;
const KST_SLOT_FORMAT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

interface CollectedListings {
  received: number;
  listings: ArtJobListing[];
}

interface ImageAttachment {
  fileId: string;
  altText: string;
}

// 게임잡 원화 공고 → 채널. 머리 메시지 1통(멘션) + 공고마다 1통(이미지 1장).
//
// 장부 기록은 게시 **뒤에** 한다. 게시 후 기록이 실패하면 다음 회차에 한 번 더 나가고,
// 기록 후 게시가 실패하면 그 공고는 영영 안 나간다 — 중복이 유실보다 낫다.
@Processor(ART_JOB_FEED_CRON_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class ArtJobFeedCronConsumer extends ObservedWorkerHost {
  private readonly logger = new Logger(ArtJobFeedCronConsumer.name);

  constructor(
    @Inject(ART_JOB_SOURCE_PORT)
    private readonly source: ArtJobSourcePort,
    @Inject(GAME_IMAGE_RESOLVER_PORT)
    private readonly imageResolver: GameImageResolverPort,
    @Inject(IMAGE_DOWNLOADER_PORT)
    private readonly imageDownloader: ImageDownloaderPort,
    @Inject(ART_JOB_POSTING_REPOSITORY_PORT)
    private readonly repository: ArtJobPostingRepositoryPort,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<ArtJobFeedCronJobData>): Promise<void> {
    const { target, ownerSlackUserId } = job.data;
    try {
      await this.run(job.data);
      this.notificationPublisher?.publishRecovery(INCIDENT_KEY);
    } catch (error) {
      this.logger.error(`${CRON_NAME} 실패 (target=${target})`, error);
      this.notifyOwnerFailure(ownerSlackUserId, error);
      throw error;
    }
  }

  private async run({
    target,
    mentionUserId,
  }: ArtJobFeedCronJobData): Promise<void> {
    const collected = await this.collect();
    // 받은 행은 있는데 파싱이 0 이면 사이트 마크업이 바뀐 것이다. 조용히 "새 공고 없음"
    // 으로 끝나면 몇 주가 지나도 아무도 모른다.
    if (collected.received > 0 && collected.listings.length === 0) {
      throw new Error(
        `게임잡 목록 ${collected.received}행을 받았지만 파싱 0건 — 마크업 변경 의심`,
      );
    }

    const targets = collected.listings.filter((listing) => {
      return isTargetArtRole(listing.title);
    });
    const isFirstRun = await this.repository.isEmpty();
    const known = await this.repository.findKnownSourceIds(
      targets.map((listing) => listing.sourceId),
    );
    const fresh = targets.filter((listing) => {
      return !known.has(listing.sourceId);
    });
    const toPost = fresh.slice(0, MAX_POSTINGS_PER_RUN);
    if (isFirstRun) {
      // 첫 실행에 등록일순 80건을 다 쏟지 않는다. 최신 상한만 보내고 나머지는 본 것으로만 둔다.
      await this.repository.markSeeded(fresh.slice(MAX_POSTINGS_PER_RUN));
    }

    this.logger.log(
      `${CRON_NAME} — 수신 ${collected.received} · 파싱 ${collected.listings.length} · 대상 ${targets.length} · 신규 ${fresh.length} · 게시 ${toPost.length}`,
    );
    if (toPost.length === 0) {
      return;
    }

    const firstRun = await this.cronIdempotency.acquireOnce(
      `cron:${ART_JOB_FEED_CRON_QUEUE}:${target}:${KST_SLOT_FORMAT.format(new Date())}`,
      SLOT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(`${CRON_NAME} 중복 발송 차단 — 이 슬롯은 이미 처리됨`);
      return;
    }

    await this.slackNotifier.postMessage({
      kind: 'art-job-feed',
      target,
      text: formatArtJobHeader({ count: toPost.length, mentionUserId }),
    });
    for (const listing of toPost) {
      await this.postOne(target, listing);
    }
  }

  private async collect(): Promise<CollectedListings> {
    let received = 0;
    const bySourceId = new Map<string, ArtJobListing>();
    for (let page = 1; page <= LIST_PAGES_PER_RUN; page += 1) {
      const result = await this.source.fetchLatest(page);
      received += result.received;
      for (const listing of result.listings) {
        if (!bySourceId.has(listing.sourceId)) {
          bySourceId.set(listing.sourceId, listing);
        }
      }
    }
    return { received, listings: [...bySourceId.values()] };
  }

  private async postOne(target: string, listing: ArtJobListing): Promise<void> {
    const resolved = await this.imageResolver.resolve(listing);
    const image = await this.uploadImage(listing, resolved);
    await this.slackNotifier.postMessage({
      kind: 'art-job-feed',
      target,
      text: formatArtJobPosting(listing, resolved),
      // 공고 링크 미리보기는 게임잡 공통 로고라 정보가 없고 메시지만 길어진다.
      unfurlLinks: false,
      ...(image ? { image } : {}),
    });
    await this.repository.markNotified({ listing, resolved });
  }

  // 이미지 실패는 공고 발송을 막지 않는다 — 글만이라도 보낸다.
  private async uploadImage(
    listing: ArtJobListing,
    resolved: ResolvedArtJobImage,
  ): Promise<ImageAttachment | null> {
    if (!resolved.image) {
      return null;
    }
    try {
      const downloaded = await this.imageDownloader.download(
        resolved.image.url,
      );
      const { fileId } = await this.slackNotifier.uploadImageFile({
        png: downloaded.buffer,
        filename: downloaded.filename,
        title: resolved.gameTitle ?? listing.company,
      });
      return { fileId, altText: resolved.gameTitle ?? listing.company };
    } catch (error) {
      this.logger.warn(
        `${CRON_NAME} 이미지 첨부 실패 — GI_No=${listing.sourceId}, url=${resolved.image.url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private notifyOwnerFailure(
    ownerSlackUserId: string | null,
    error: unknown,
  ): void {
    if (!this.notificationPublisher || !ownerSlackUserId) {
      return;
    }
    this.notificationPublisher.publishCronFailure({
      cronName: CRON_NAME,
      incidentKey: INCIDENT_KEY,
      ownerSlackUserId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
