import { Processor } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import { todayInKst } from '../../agent/vacation/domain/plain-date';
import { exclusionKey } from '../../art-job-feed/domain/art-job-exclusion';
import {
  ArtJobImage,
  ArtJobListing,
  ResolvedArtJobImage,
} from '../../art-job-feed/domain/art-job-feed.type';
import { findMatchedTerms } from '../../art-job-feed/domain/art-job-keyword';
import { isTargetArtRole } from '../../art-job-feed/domain/art-role.filter';
import { deadlineDateOf } from '../../art-job-feed/domain/deadline';
import {
  ART_JOB_SOURCES,
  ArtJobSourcePort,
  GAME_IMAGE_RESOLVER_PORT,
  GameImageResolverPort,
  IMAGE_DOWNLOADER_PORT,
  ImageDownloaderPort,
  sourceOf,
} from '../../art-job-feed/domain/port/art-job-feed.ports';
import {
  ART_JOB_KEYWORD_REPOSITORY_PORT,
  ArtJobKeywordRepositoryPort,
} from '../../art-job-feed/domain/port/art-job-keyword.repository.port';
import {
  ART_JOB_POSTING_REPOSITORY_PORT,
  ArtJobPostingRepositoryPort,
  listingKey,
} from '../../art-job-feed/domain/port/art-job-posting.repository.port';
import {
  ArtJobDigestItem,
  formatArtJobDigest,
  formatArtJobImageCaption,
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
  ArtJobFeedRunResult,
  LIST_PAGES_PER_RUN,
  MAX_POSTINGS_PER_RUN,
} from '../domain/art-job-feed-cron.type';

const CRON_NAME = 'Art Job Feed Cron';

interface ImageCaption {
  image: ArtJobImage;
  text: string;
  altText: string;
}

// 확인된 그림만 스레드에 싣는다. 없으면 본문의 구글 검색 링크로 대신한다.
const buildImageCaption = (
  order: number,
  resolved: ResolvedArtJobImage,
): ImageCaption | null => {
  const name = resolved.representativeGame ?? resolved.gameTitle;
  if (!resolved.image || !name) {
    return null;
  }
  return {
    image: resolved.image,
    text: formatArtJobImageCaption(
      order,
      name,
      resolved.image,
      Boolean(resolved.representativeGame),
    ),
    altText: name,
  };
};
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

interface ImageReplyInput {
  target: string;
  threadTs: string;
  order: number;
  item: ArtJobDigestItem;
}

// 게임잡 원화 공고 → 채널. 회차당 본문 1통(멘션 + 공고 목록), 플레이스토어 이미지는 그 스레드에.
//
// 장부 기록은 게시 **뒤에** 한다. 게시 후 기록이 실패하면 다음 회차에 한 번 더 나가고,
// 기록 후 게시가 실패하면 그 공고는 영영 안 나간다 — 중복이 유실보다 낫다.
// cron 과 수동 FETCH 를 한 워커에서 직렬화해야 게시 장부의 중복 판정이 안전하다.
@Processor(ART_JOB_FEED_CRON_QUEUE, {
  ...LONG_RUNNING_WORKER_OPTIONS,
  concurrency: 1,
})
export class ArtJobFeedCronConsumer extends ObservedWorkerHost {
  private readonly logger = new Logger(ArtJobFeedCronConsumer.name);

  constructor(
    @Inject(ART_JOB_SOURCES)
    private readonly sources: ArtJobSourcePort[],
    @Inject(GAME_IMAGE_RESOLVER_PORT)
    private readonly imageResolver: GameImageResolverPort,
    @Inject(IMAGE_DOWNLOADER_PORT)
    private readonly imageDownloader: ImageDownloaderPort,
    @Inject(ART_JOB_POSTING_REPOSITORY_PORT)
    private readonly repository: ArtJobPostingRepositoryPort,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
    @Inject(ART_JOB_KEYWORD_REPOSITORY_PORT)
    private readonly keywordRepository: ArtJobKeywordRepositoryPort,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<ArtJobFeedCronJobData>): Promise<ArtJobFeedRunResult> {
    const { target, ownerSlackUserId } = job.data;
    try {
      const result = await this.run(job);
      this.notificationPublisher?.publishRecovery(INCIDENT_KEY);
      return result;
    } catch (error) {
      this.logger.error(`${CRON_NAME} 실패 (target=${target})`, error);
      this.notifyOwnerFailure(ownerSlackUserId, error);
      throw error;
    }
  }

  private async run(
    job: Job<ArtJobFeedCronJobData>,
  ): Promise<ArtJobFeedRunResult> {
    const { target, mentionUserId, trigger } = job.data;
    const keywords = await this.keywordRepository.load();
    const collected = await this.collect();

    const targets = collected.listings.filter((listing) => {
      return isTargetArtRole(listing.title, keywords);
    });
    const isFirstRun = await this.repository.isEmpty();
    const known = await this.repository.findKnownKeys(targets);
    const excluded = await this.repository.findExcludedKeys();
    const unseen = targets.filter((listing) => {
      return !known.has(listingKey(listing));
    });
    // 받는 사람이 「관심 없음」으로 뺀 공고가 새 번호로 다시 올라온 것. 장부에 남기지 않고 매 회차 거른다.
    const fresh = unseen.filter((listing) => {
      return !excluded.has(exclusionKey(listing.company, listing.title));
    });
    const toPost = fresh.slice(0, MAX_POSTINGS_PER_RUN);
    if (isFirstRun) {
      // 첫 실행에 등록일순 80건을 다 쏟지 않는다. 최신 상한만 보내고 나머지는 본 것으로만 둔다.
      await this.repository.markSeeded(fresh.slice(MAX_POSTINGS_PER_RUN));
    }

    this.logger.log(
      `${CRON_NAME} — 수신 ${collected.received} · 파싱 ${collected.listings.length} · 대상 ${targets.length} · 신규 ${fresh.length} · 제외 ${unseen.length - fresh.length} · 게시 ${toPost.length}`,
    );
    if (toPost.length === 0) {
      return { kind: 'NO_NEW' };
    }

    const slotKey =
      trigger === 'MANUAL'
        ? `cron:${ART_JOB_FEED_CRON_QUEUE}:${target}:manual:${job.id}`
        : `cron:${ART_JOB_FEED_CRON_QUEUE}:${target}:${KST_SLOT_FORMAT.format(new Date())}`;
    const firstRun = await this.cronIdempotency.acquireOnce(
      slotKey,
      SLOT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(`${CRON_NAME} 중복 발송 차단 — 이 슬롯은 이미 처리됨`);
      return { kind: 'SLOT_TAKEN' };
    }
    try {
      await this.postDigest(target, mentionUserId, toPost, keywords.style);
      return { kind: 'POSTED', count: toPost.length };
    } catch (error) {
      // 가드를 쥔 채 실패하면 BullMQ 재시도가 "이미 처리됨" 으로 성공 처리돼 공고가 빠진다.
      // 이미 나간 공고는 장부(markNotified)가 막으므로, 가드를 풀어도 중복 게시는 생기지 않는다.
      await this.cronIdempotency.release(slotKey);
      throw error;
    }
  }

  private async postDigest(
    target: string,
    mentionUserId: string | null,
    toPost: ArtJobListing[],
    styleTerms: string[],
  ): Promise<void> {
    const items: ArtJobDigestItem[] = [];
    for (const listing of toPost) {
      let body = '';
      try {
        body = await sourceOf(this.sources, listing).fetchPostingBody(listing);
      } catch (error) {
        this.logger.warn(
          `${CRON_NAME} 공고 본문 조회 실패 — ${listingKey(listing)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      items.push({
        listing,
        resolved: await this.imageResolver.resolve(listing),
        styleTags: findMatchedTerms(styleTerms, `${listing.title}\n${body}`),
      });
    }
    // 라벨·버튼·장부 마감일이 같은 "오늘"을 기준으로 계산되게 한 번만 잡는다.
    const today = todayInKst(new Date());
    const { ts } = await this.slackNotifier.postMessage({
      kind: 'art-job-feed',
      target,
      ...formatArtJobDigest({ items, mentionUserId, today }),
      // 공고 링크 미리보기는 게임잡 공통 로고라 정보가 없고 메시지만 길어진다.
      unfurlLinks: false,
    });
    for (const item of items) {
      await this.repository.markNotified({
        ...item,
        deadlineDate: deadlineDateOf(item.listing.deadlineText, today),
      });
    }
    if (!ts) {
      return;
    }
    for (const [index, item] of items.entries()) {
      await this.replyWithImage({
        target,
        threadTs: ts,
        order: index + 1,
        item,
      });
    }
  }

  // 소스 순서(게임잡 → 사람인)대로 모으고, 같은 공고가 양쪽에 있으면 앞 소스 것만 남긴다.
  // 주 소스(첫 번째) 실패는 던지고, 보조 소스 실패는 경고만 남긴다 — 사람인은 베타 API 라
  // 그쪽 장애로 게임잡 공고까지 못 나가면 안 된다.
  private async collect(): Promise<CollectedListings> {
    let received = 0;
    const byKey = new Map<string, ArtJobListing>();
    const seenPostings = new Set<string>();
    for (const [index, source] of this.sources.entries()) {
      let listings: ArtJobListing[];
      try {
        const fetched = await this.collectFrom(source);
        received += fetched.received;
        listings = fetched.listings;
      } catch (error) {
        if (index === 0) {
          throw error;
        }
        this.logger.warn(
          `${CRON_NAME} 보조 소스(${source.source}) 수집 실패 — 건너뜀: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }
      // 앞 소스에 이미 있는 회사+제목만 거른다. 같은 소스 안에서 제목이 같은 공고는
      // 번호가 다른 별개 공고일 수 있어(예: 팀별 동일 제목) 그대로 둔다.
      const earlierPostings = new Set(seenPostings);
      for (const listing of listings) {
        const postingKey = exclusionKey(listing.company, listing.title);
        if (earlierPostings.has(postingKey)) {
          continue;
        }
        seenPostings.add(postingKey);
        byKey.set(listingKey(listing), listing);
      }
    }
    return { received, listings: [...byKey.values()] };
  }

  private async collectFrom(
    source: ArtJobSourcePort,
  ): Promise<CollectedListings> {
    let received = 0;
    const bySourceId = new Map<string, ArtJobListing>();
    for (let page = 1; page <= LIST_PAGES_PER_RUN; page += 1) {
      const result = await source.fetchLatest(page);
      received += result.received;
      for (const listing of result.listings) {
        if (!bySourceId.has(listing.sourceId)) {
          bySourceId.set(listing.sourceId, listing);
        }
      }
    }
    // 받은 행은 있는데 파싱이 0 이면 사이트 마크업·응답 형태가 바뀐 것이다. 조용히 "새 공고 없음"
    // 으로 끝나면 몇 주가 지나도 아무도 모른다.
    if (received > 0 && bySourceId.size === 0) {
      throw new Error(
        `${source.source} 목록 ${received}행을 받았지만 파싱 0건 — 마크업·응답 형태 변경 의심`,
      );
    }
    return { received, listings: [...bySourceId.values()] };
  }

  // 이미지 실패는 본문에 영향이 없다 — 이미 목록은 나갔고 스레드 그림만 빠진다.
  private async replyWithImage({
    target,
    threadTs,
    order,
    item,
  }: ImageReplyInput): Promise<void> {
    const { listing, resolved } = item;
    const caption = buildImageCaption(order, resolved);
    if (!caption) {
      return;
    }
    try {
      const downloaded = await this.imageDownloader.download(caption.image.url);
      const { fileId } = await this.slackNotifier.uploadImageFile({
        png: downloaded.buffer,
        filename: downloaded.filename,
        title: caption.altText,
      });
      await this.slackNotifier.postMessage({
        kind: 'art-job-feed',
        target,
        threadTs,
        text: caption.text,
        image: { fileId, altText: caption.altText },
      });
    } catch (error) {
      this.logger.warn(
        `${CRON_NAME} 스레드 이미지 실패 — ${listing.sourceId}, url=${caption.image.url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
