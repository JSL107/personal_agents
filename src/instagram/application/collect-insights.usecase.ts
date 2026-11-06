import { basename, dirname } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { toInstagramError } from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import {
  EMPTY_INSIGHT_METRICS,
  InsightCapture,
  InsightSnapshot,
  SnapshotError,
  SnapshotWindow,
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
export interface CollectInsightsSummary {
  inserted: number;
  skipped: number;
  failed: number;
  featuresFilled: number;
}

interface DueTarget {
  post: InstagramPost;
  ageMinutes: number;
  windows: SnapshotWindow[];
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
    const savedSnapshots = await this.snapshots.listByPostIds(
      published.map((post) => post.id),
    );
    for (const post of published) {
      if (await this.fillFeatures(post)) {
        summary.featuresFilled += 1;
      }
    }
    const targets = published
      .map((post) => toDueTarget({ post, now, savedSnapshots }))
      .filter((target) => target.windows.length > 0);
    if (targets.length === 0) {
      return summary;
    }
    // 찍을 창이 있는 회차에만 한 번 묻는다.
    const followersCount = await this.readFollowers();

    for (const { post, ageMinutes, windows } of targets) {
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
          summary.failed += 1;
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
    const base = {
      postId: post.id,
      capturedAt: now,
      ageMinutes,
      followersCount,
    };
    try {
      const result = await this.graph.getMediaInsights({
        mediaId: post.mediaId ?? '',
        kind,
      });
      if (result.kind === MediaInsightsResultKind.NOT_ENOUGH_VIEWERS) {
        return {
          ...base,
          metrics: EMPTY_INSIGHT_METRICS,
          error: SnapshotError.NOT_ENOUGH_VIEWERS,
          raw: result.raw,
        };
      }
      return { ...base, metrics: result.metrics, error: null, raw: result.raw };
    } catch (error) {
      if (toInstagramError({ error, code: InstagramErrorCode.TOKEN_INVALID })) {
        throw new TokenInvalidStop();
      }
      throw error;
    }
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

const toDueTarget = ({
  post,
  now,
  savedSnapshots,
}: {
  post: InstagramPost;
  now: Date;
  savedSnapshots: InsightSnapshot[];
}): DueTarget => {
  const publishedAt = post.publishedAt ?? now;
  const ageMinutes = Math.floor(
    (now.getTime() - publishedAt.getTime()) / MINUTE_MS,
  );
  const capturedWindows = savedSnapshots
    .filter((snapshot) => snapshot.postId === post.id)
    .map((snapshot) => snapshot.snapshotWindow);
  const windows = dueWindows({ post, ageMinutes, capturedWindows });
  return { post, ageMinutes, windows };
};
