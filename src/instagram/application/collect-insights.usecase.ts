import { basename, dirname } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { toInstagramError } from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import {
  InsightCapture,
  InsightMetrics,
  SnapshotError,
} from '../domain/instagram-insight.type';
import {
  InstagramPost,
  InstagramPostField,
} from '../domain/instagram-post.type';
import {
  INSTAGRAM_INSIGHT_SNAPSHOT_REPOSITORY_PORT,
  InstagramInsightSnapshotRepositoryPort,
} from '../domain/port/instagram-insight-snapshot.repository.port';
import {
  INSTAGRAM_POST_REPOSITORY_PORT,
  InstagramPostRepositoryPort,
} from '../domain/port/instagram-post.repository.port';
import {
  InsightKind,
  MediaInsightsResultKind,
  META_GRAPH_PORT,
  MetaGraphPort,
} from '../domain/port/meta-graph.port';
import { extractReelFeatures } from '../domain/reel-features';
import {
  dueWindows,
  INSIGHT_LOOKBACK_MINUTES,
} from '../domain/snapshot-window.policy';
import { readReelScript } from './read-reel-script';

const MINUTE_MS = 60_000;
const EMPTY_METRICS: InsightMetrics = {
  views: null,
  reach: null,
  likes: null,
  comments: null,
  shares: null,
  saved: null,
  totalInteractions: null,
  reposts: null,
  replies: null,
  avgWatchMs: null,
  totalWatchMs: null,
  skipRate: null,
};

export interface CollectInsightsSummary {
  inserted: number;
  skipped: number;
  failed: number;
  featuresFilled: number;
}

class TokenInvalidStop extends Error {}

// 게시물마다 도래한 창의 인사이트를 찍는다. Meta 는 읽기만 한다.
// 일시 실패는 행을 만들지 않아 다음 회차가 다시 한다. 어떤 실패도 밖으로 던지지 않는다.
@Injectable()
export class CollectInsightsUsecase {
  private readonly logger = new Logger(CollectInsightsUsecase.name);
  now = (): Date => new Date();

  constructor(
    @Inject(INSTAGRAM_POST_REPOSITORY_PORT)
    private readonly posts: InstagramPostRepositoryPort,
    @Inject(INSTAGRAM_INSIGHT_SNAPSHOT_REPOSITORY_PORT)
    private readonly snapshots: InstagramInsightSnapshotRepositoryPort,
    @Inject(META_GRAPH_PORT) private readonly graph: MetaGraphPort,
  ) {}

  async execute(): Promise<CollectInsightsSummary> {
    const summary: CollectInsightsSummary = {
      inserted: 0,
      skipped: 0,
      failed: 0,
      featuresFilled: 0,
    };
    if (!this.graph.isConfigured()) {
      return summary;
    }
    const now = this.now();
    const since = new Date(
      now.getTime() - INSIGHT_LOOKBACK_MINUTES * MINUTE_MS,
    );
    const published = await this.posts.listPublishedSince(since);
    const existing = await this.snapshots.listByPostIds(
      published.map((post) => post.id),
    );
    let followersCount: number | null | undefined;

    for (const post of published) {
      if (await this.fillFeatures(post)) {
        summary.featuresFilled += 1;
      }
      const ageMinutes = Math.floor(
        (now.getTime() - (post.publishedAt ?? now).getTime()) / MINUTE_MS,
      );
      const windows = dueWindows({
        post,
        ageMinutes,
        existing: existing
          .filter((snapshot) => snapshot.postId === post.id)
          .map((snapshot) => snapshot.snapshotWindow),
      });
      if (windows.length === 0) {
        continue;
      }
      if (followersCount === undefined) {
        followersCount = await this.readFollowers();
      }
      try {
        const snapshot = await this.capture({
          post,
          now,
          ageMinutes,
          followersCount,
        });
        for (const snapshotWindow of windows) {
          const isNew = await this.snapshots.insertIfAbsent({
            ...snapshot,
            snapshotWindow,
          });
          if (isNew) {
            summary.inserted += 1;
          } else {
            summary.skipped += 1;
          }
        }
      } catch (error) {
        if (error instanceof TokenInvalidStop) {
          this.logger.warn('인사이트 수집 중단: 인스타 토큰 무효');
          break;
        }
        summary.failed += 1;
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`${post.reelKey} 인사이트 수집 실패: ${reason}`);
      }
    }
    return summary;
  }

  private async capture({
    post,
    now,
    ageMinutes,
    followersCount,
  }: {
    post: InstagramPost;
    now: Date;
    ageMinutes: number;
    followersCount: number | null;
  }): Promise<InsightCapture> {
    const kind =
      post.field === InstagramPostField.STORY
        ? InsightKind.STORY
        : InsightKind.REELS;
    let result;
    try {
      result = await this.graph.getMediaInsights({
        mediaId: post.mediaId ?? '',
        kind,
      });
    } catch (error) {
      if (toInstagramError({ error, code: InstagramErrorCode.TOKEN_INVALID })) {
        throw new TokenInvalidStop();
      }
      throw error;
    }
    const base = {
      postId: post.id,
      capturedAt: now,
      ageMinutes,
      followersCount,
    };
    if (result.kind === MediaInsightsResultKind.NOT_ENOUGH_VIEWERS) {
      return {
        ...base,
        metrics: EMPTY_METRICS,
        error: SnapshotError.NOT_ENOUGH_VIEWERS,
        raw: result.raw,
      };
    }
    return { ...base, metrics: result.metrics, error: null, raw: result.raw };
  }

  // 날짜 폴더는 30일 뒤 정리되므로 특성은 처음 볼 때 DB 로 옮겨 둔다. 스토리는 비교할 특성이 없다.
  private async fillFeatures(post: InstagramPost): Promise<boolean> {
    if (post.features || post.field === InstagramPostField.STORY) {
      return false;
    }
    try {
      const script = await readReelScript(post.videoPath);
      const features = extractReelFeatures({
        script,
        folderField: basename(dirname(post.videoPath)),
      });
      if (!features) {
        return false;
      }
      await this.posts.setFeatures({ id: post.id, features });
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${post.reelKey} 특성 저장 실패: ${reason}`);
      return false;
    }
  }

  private async readFollowers(): Promise<number | null> {
    try {
      return await this.graph.getFollowersCount();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`팔로워 수 조회 실패: ${reason}`);
      return null;
    }
  }
}
