import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

import { ApplyResult } from '../../preview-gate/domain/apply-result.type';
import {
  ApplyProgress,
  PreviewApplier,
} from '../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { InstagramException } from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import {
  InstagramPost,
  parseReelPublishPayload,
  ReelPublishPayload,
} from '../domain/instagram-post.type';
import {
  INSTAGRAM_POST_REPOSITORY_PORT,
  InstagramPostRepositoryPort,
} from '../domain/port/instagram-post.repository.port';
import {
  ContainerStatus,
  META_GRAPH_PORT,
  MetaGraphPort,
  PublishedMedia,
} from '../domain/port/meta-graph.port';

@Injectable()
export class InstagramReelPublishApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.INSTAGRAM_REEL_PUBLISH;
  readonly resumable = true;
  pollIntervalMs = 60_000;
  maxPolls = 5;
  settleIntervalMs = 20_000;
  settleChecks = 3;
  recentMediaLimit = 25;
  // 게시 결과가 불확실한 뒤 같은 컨테이너로 다시 게시하기까지 기다리는 시간. 재조회 60초만으로는
  // Meta 쪽 PUBLISHED 반영·게시물 목록 반영 지연을 덮지 못해, 실제로 올라간 릴스를 한 번 더 올릴 수 있다.
  republishAfterMs = 10 * 60_000;

  constructor(
    @Inject(INSTAGRAM_POST_REPOSITORY_PORT)
    private readonly repository: InstagramPostRepositoryPort,
    @Inject(META_GRAPH_PORT) private readonly graph: MetaGraphPort,
  ) {}

  async apply(
    preview: PreviewAction,
    progress?: ApplyProgress,
  ): Promise<ApplyResult> {
    if (!this.graph.isConfigured()) {
      throw this.failure(
        InstagramErrorCode.PUBLISH_DISABLED,
        '인스타 게시가 꺼져 있습니다(INSTAGRAM_PUBLISH_ENABLED)',
      );
    }
    let post: InstagramPost | undefined;
    try {
      const payload = parseReelPublishPayload(preview.payload);
      post = await this.repository.claim({
        reelKey: payload.reelKey,
        field: payload.field,
        title: payload.title,
        videoPath: payload.videoPath,
        videoSha256: payload.videoSha256,
        caption: payload.caption,
        previewActionId: preview.id,
      });
      if (post.status === 'PUBLISHED') {
        return this.result(post.permalink ?? '');
      }
      return await this.execute(post, payload, progress);
    } catch (error) {
      const failure =
        error instanceof InstagramException
          ? error
          : new InstagramException({
              code: InstagramErrorCode.GRAPH_REQUEST_FAILED,
              message: '인스타 게시 처리에 실패했습니다',
              cause: error,
            });
      if (
        post &&
        !(failure.instagramErrorCode === InstagramErrorCode.REEL_CLAIMED)
      ) {
        try {
          await this.repository.update(post.id, {
            lastError: `${failure.errorCode}: ${failure.message}`,
          });
        } catch (persistenceError) {
          throw new InstagramException({
            code: failure.instagramErrorCode,
            message: failure.message,
            cause: { failure, persistenceError },
          });
        }
      }
      throw failure;
    }
  }

  private async execute(
    initial: InstagramPost,
    payload: ReelPublishPayload,
    progress?: ApplyProgress,
  ): Promise<ApplyResult> {
    let post = initial;
    if (post.mediaId) {
      return this.finishConfirmed(post, payload, progress);
    }
    if (post.publishAttemptedAt && !post.containerId) {
      throw this.failure(
        InstagramErrorCode.PUBLISH_UNCONFIRMED,
        '게시 시도 기록에 컨테이너가 없어 결과를 확인할 수 없습니다',
      );
    }
    if (post.containerId) {
      let state = await this.graph.getContainerStatus(post.containerId);
      if (state.statusCode === 'PUBLISHED') {
        return this.finish(post, payload, progress);
      }
      if (post.publishAttemptedAt && state.statusCode === 'FINISHED') {
        state = await this.settle(post.containerId);
        if (state.statusCode === 'PUBLISHED') {
          return this.finish(post, payload, progress);
        }
        if (state.statusCode === 'FINISHED') {
          const matched = await this.reconcile(post, payload);
          if (matched) {
            return this.finishMatched(post, matched, progress);
          }
          const elapsedMs = Date.now() - post.publishAttemptedAt.getTime();
          if (elapsedMs < this.republishAfterMs) {
            throw this.failure(
              InstagramErrorCode.PUBLISH_UNCONFIRMED,
              '게시 여부를 아직 확인 중입니다. 10분쯤 뒤 다시 누르세요',
            );
          }
        }
      }
      if (state.statusCode === 'ERROR' || state.statusCode === 'EXPIRED') {
        post = await this.repository.update(post.id, {
          containerId: null,
          containerCreatedAt: null,
          uploadedAt: null,
          publishAttemptedAt: null,
          status: 'PENDING',
        });
      } else if (post.publishAttemptedAt && state.statusCode !== 'FINISHED') {
        throw this.failure(
          InstagramErrorCode.PUBLISH_UNCONFIRMED,
          '게시 여부를 확인하지 못했습니다. 인스타 계정을 먼저 확인한 뒤 다시 누르세요',
        );
      }
    }
    if (!post.containerId || (!post.uploadedAt && !post.publishAttemptedAt)) {
      let video: Buffer;
      try {
        video = await readFile(payload.videoPath);
      } catch (error) {
        throw new InstagramException({
          code: InstagramErrorCode.VIDEO_MISSING,
          message: '릴스 영상을 찾을 수 없습니다',
          cause: error,
        });
      }
      const digest = createHash('sha256').update(video).digest('hex');
      if (digest !== payload.videoSha256) {
        throw this.failure(
          InstagramErrorCode.VIDEO_CHANGED,
          '릴스 영상이 변경되었습니다',
        );
      }
      await this.checkQuota();
      const container = await this.graph.createReelContainer(payload.caption);
      post = await this.repository.update(post.id, {
        containerId: container.containerId,
        containerCreatedAt: new Date(),
        uploadedAt: null,
        publishAttemptedAt: null,
      });
      await this.graph.uploadVideo(container.uploadUri, video);
      post = await this.repository.update(post.id, { uploadedAt: new Date() });
      await progress?.record('container');
    }
    const containerId = post.containerId;
    if (!containerId) {
      throw this.failure(
        InstagramErrorCode.CONTAINER_FAILED,
        '컨테이너가 없습니다',
      );
    }
    const polled = await this.poll(containerId);
    if (polled === 'PUBLISHED') {
      return this.finish(post, payload, progress);
    }
    await this.checkQuota();
    post = await this.repository.update(post.id, {
      status: 'PUBLISHING',
      publishAttemptedAt: new Date(),
    });
    let published: PublishedMedia;
    try {
      published = await this.graph.publish(containerId);
    } catch (error) {
      if (
        error instanceof InstagramException &&
        error.instagramErrorCode === InstagramErrorCode.TOKEN_INVALID
      ) {
        throw error;
      }
      const state = await this.settle(containerId);
      if (state.statusCode === 'ERROR' || state.statusCode === 'EXPIRED') {
        await this.repository.update(post.id, { publishAttemptedAt: null });
      }
      try {
        return await this.finish(post, payload, progress);
      } catch (settleError) {
        if (
          settleError instanceof InstagramException &&
          settleError.instagramErrorCode ===
            InstagramErrorCode.PUBLISH_UNCONFIRMED &&
          error instanceof InstagramException
        ) {
          throw this.failure(
            InstagramErrorCode.PUBLISH_UNCONFIRMED,
            `${settleError.message} (${error.errorCode}: ${error.message})`,
          );
        }
        throw settleError;
      }
    }
    try {
      post = await this.repository.update(post.id, {
        mediaId: published.mediaId,
      });
      await progress?.record('publish');
      return await this.finish(post, payload, progress, published.configIssue);
    } catch (error) {
      throw this.confirmedFailure(error);
    }
  }

  private async finishConfirmed(
    post: InstagramPost,
    payload: ReelPublishPayload,
    progress?: ApplyProgress,
  ): Promise<ApplyResult> {
    try {
      return await this.finish(post, payload, progress);
    } catch (error) {
      throw this.confirmedFailure(error);
    }
  }

  private confirmedFailure(error: unknown): InstagramException {
    return new InstagramException({
      code: InstagramErrorCode.PUBLISH_UNCONFIRMED,
      message:
        '인스타에는 올라갔지만 기록을 마치지 못했습니다. 잠시 뒤 다시 누르면 올라간 게시물을 찾아 기록합니다',
      cause: error,
    });
  }

  private async checkQuota(): Promise<void> {
    const limit = await this.graph.getPublishingLimit();
    if (limit.usage >= limit.total) {
      throw this.failure(
        InstagramErrorCode.QUOTA_EXCEEDED,
        '인스타 게시 한도를 초과했습니다',
      );
    }
  }

  private async poll(containerId: string): Promise<'FINISHED' | 'PUBLISHED'> {
    for (let index = 0; index < this.maxPolls; index++) {
      const state = await this.graph.getContainerStatus(containerId);
      if (state.statusCode === 'FINISHED') {
        return 'FINISHED';
      }
      if (state.statusCode === 'ERROR' || state.statusCode === 'EXPIRED') {
        throw this.failure(
          InstagramErrorCode.CONTAINER_FAILED,
          `인스타 영상 처리 실패: ${state.status ?? state.statusCode}`,
        );
      }
      if (state.statusCode === 'PUBLISHED') {
        return 'PUBLISHED';
      }
      if (index < this.maxPolls - 1) {
        await this.wait(this.pollIntervalMs);
      }
    }
    throw this.failure(
      InstagramErrorCode.PROCESSING_TIMEOUT,
      '인스타가 아직 영상을 처리 중입니다. 잠시 뒤 다시 누르면 이어서 확인합니다',
    );
  }

  private async settle(containerId: string): Promise<ContainerStatus> {
    let state: ContainerStatus = { statusCode: 'FINISHED', status: null };
    for (let index = 0; index < this.settleChecks; index++) {
      await this.wait(this.settleIntervalMs);
      state = await this.graph.getContainerStatus(containerId);
      if (state.statusCode !== 'FINISHED') {
        return state;
      }
    }
    return state;
  }

  private async reconcile(post: InstagramPost, payload: ReelPublishPayload) {
    const media = await this.graph.listRecentMedia(this.recentMediaLimit);
    const matches = media.filter(
      (item) =>
        item.caption !== null &&
        this.normalizeCaption(item.caption) ===
          this.normalizeCaption(payload.caption) &&
        post.containerCreatedAt !== null &&
        new Date(item.timestamp).getTime() >=
          Math.floor(post.containerCreatedAt.getTime() / 1000) * 1000,
    );
    if (matches.length > 1) {
      throw this.failure(
        InstagramErrorCode.PUBLISH_UNCONFIRMED,
        '게시 여부를 확인하지 못했습니다. 일치하는 게시물이 여러 개입니다',
      );
    }
    return matches[0] ?? null;
  }

  private normalizeCaption(caption: string): string {
    const normalized = caption
      .normalize('NFC')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
    return normalized;
  }

  private async finish(
    post: InstagramPost,
    payload: ReelPublishPayload,
    progress?: ApplyProgress,
    issue: string | null = null,
  ): Promise<ApplyResult> {
    if (post.mediaId) {
      const detail = await this.graph.getMedia(post.mediaId);
      return this.finishMatched(
        post,
        { ...detail, id: post.mediaId },
        progress,
        issue,
      );
    }
    const matched = await this.reconcile(post, payload);
    if (!matched) {
      throw this.failure(
        InstagramErrorCode.PUBLISH_UNCONFIRMED,
        '게시 여부를 확인하지 못했습니다. 인스타 계정을 먼저 확인한 뒤 다시 누르세요',
      );
    }
    return this.finishMatched(post, matched, progress, issue);
  }

  private async finishMatched(
    post: InstagramPost,
    media: { id: string; permalink: string; timestamp: string },
    progress?: ApplyProgress,
    issue: string | null = null,
  ): Promise<ApplyResult> {
    await this.repository.update(post.id, {
      mediaId: media.id,
      permalink: media.permalink,
      publishedAt: new Date(media.timestamp),
      status: 'PUBLISHED',
      lastError: null,
    });
    await progress?.record('finish');
    return this.result(media.permalink, issue);
  }

  private result(permalink: string, issue: string | null = null): ApplyResult {
    const warning = issue ? ` (주의: ${issue})` : '';
    return {
      message: `인스타에 올렸어요: ${permalink}${warning}`,
      artifacts: [],
    };
  }
  private failure(
    code: InstagramErrorCode,
    message: string,
  ): InstagramException {
    return new InstagramException({ code, message });
  }
  private async wait(milliseconds: number): Promise<void> {
    if (milliseconds > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    }
  }
}
