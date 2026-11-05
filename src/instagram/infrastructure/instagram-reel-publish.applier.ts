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
import {
  InstagramException,
  toInstagramError,
} from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import {
  assertClaimable,
  isClosedWithoutPublish,
} from '../domain/instagram-post.policy';
import {
  InstagramPost,
  InstagramPostStatus,
  ReelPublishPayload,
} from '../domain/instagram-post.type';
import {
  INSTAGRAM_POST_REPOSITORY_PORT,
  InstagramPostRepositoryPort,
} from '../domain/port/instagram-post.repository.port';
import {
  ContainerStatus,
  ContainerStatusCode,
  META_GRAPH_PORT,
  MetaGraphPort,
  PublishedMedia,
  RecentMedia,
} from '../domain/port/meta-graph.port';
import { parseReelPublishPayload } from '../domain/reel-publish-payload.parser';

const PUBLISH_UNCONFIRMED_MESSAGE =
  '게시 여부를 확인하지 못했습니다. 인스타 계정을 먼저 확인한 뒤 다시 누르세요';

const normalizeCaption = (value: string): string =>
  value
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

export const isSamePost = ({
  item,
  caption,
  notBeforeMs,
}: {
  item: RecentMedia;
  caption: string;
  notBeforeMs: number | null;
}): boolean => {
  if (item.caption === null || notBeforeMs === null) {
    return false;
  }
  const sameCaption =
    normalizeCaption(item.caption) === normalizeCaption(caption);
  const postedAfterContainer =
    new Date(item.timestamp).getTime() >= notBeforeMs;
  return sameCaption && postedAfterContainer;
};

interface PublishStage {
  post: InstagramPost;
  payload: ReelPublishPayload;
  progress?: ApplyProgress;
}

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
      throw this.failure({
        code: InstagramErrorCode.PUBLISH_DISABLED,
        message: '인스타 게시가 꺼져 있습니다(INSTAGRAM_PUBLISH_ENABLED)',
      });
    }
    const payload = parseReelPublishPayload(preview.payload);
    const post = await this.repository.upsertByReelKey({
      reelKey: payload.reelKey,
      field: payload.field,
      title: payload.title,
      videoPath: payload.videoPath,
      videoSha256: payload.videoSha256,
      caption: payload.caption,
      previewActionId: preview.id,
    });
    assertClaimable({ post, previewActionId: preview.id });
    try {
      if (post.status === InstagramPostStatus.PUBLISHED) {
        return this.result({ permalink: post.permalink ?? '', issue: null });
      }
      return await this.execute({ post, payload, progress });
    } catch (error) {
      const failure =
        error instanceof InstagramException
          ? error
          : new InstagramException({
              code: InstagramErrorCode.GRAPH_REQUEST_FAILED,
              message: '인스타 게시 처리에 실패했습니다',
              cause: error,
            });
      try {
        await this.repository.update({
          id: post.id,
          patch: {
            lastError: `${failure.errorCode}: ${failure.message}`,
          },
        });
      } catch (persistenceError) {
        throw new InstagramException({
          code: failure.instagramErrorCode,
          message: failure.message,
          cause: { failure, persistenceError },
        });
      }
      throw failure;
    }
  }

  private async execute({
    post,
    payload,
    progress,
  }: PublishStage): Promise<ApplyResult> {
    const settled = await this.settleExistingContainer({
      post,
      payload,
      progress,
    });
    if ('result' in settled) {
      return settled.result;
    }
    const uploaded = await this.ensureUploadedContainer({
      post: settled.post,
      payload,
      progress,
    });
    return this.publishContainer({ post: uploaded, payload, progress });
  }

  private async settleExistingContainer({
    post,
    payload,
    progress,
  }: PublishStage): Promise<{ post: InstagramPost } | { result: ApplyResult }> {
    if (post.mediaId) {
      return {
        result: await this.finishConfirmed({ post, payload, progress }),
      };
    }
    if (post.publishAttemptedAt && !post.containerId) {
      throw this.failure({
        code: InstagramErrorCode.PUBLISH_UNCONFIRMED,
        message: '게시 시도 기록에 컨테이너가 없어 결과를 확인할 수 없습니다',
      });
    }
    if (post.containerId) {
      const current = await this.graph.getContainerStatus(post.containerId);
      if (current.statusCode === ContainerStatusCode.PUBLISHED) {
        return {
          result: await this.finish({ post, payload, progress, issue: null }),
        };
      }
      const awaitingPublishResult =
        post.publishAttemptedAt !== null &&
        current.statusCode === ContainerStatusCode.FINISHED;
      const state = awaitingPublishResult
        ? await this.settle(post.containerId)
        : current;
      if (post.publishAttemptedAt && awaitingPublishResult) {
        if (state.statusCode === ContainerStatusCode.PUBLISHED) {
          return {
            result: await this.finish({ post, payload, progress, issue: null }),
          };
        }
        if (state.statusCode === ContainerStatusCode.FINISHED) {
          const matched = await this.reconcile({ post, payload });
          if (matched) {
            return {
              result: await this.finishMatched({
                post,
                media: matched,
                progress,
                issue: null,
              }),
            };
          }
          const elapsedMs = Date.now() - post.publishAttemptedAt.getTime();
          if (elapsedMs < this.republishAfterMs) {
            throw this.failure({
              code: InstagramErrorCode.PUBLISH_UNCONFIRMED,
              message:
                '게시 여부를 아직 확인 중입니다. 10분쯤 뒤 다시 누르세요',
            });
          }
        }
      }
      if (isClosedWithoutPublish(state.statusCode)) {
        return {
          post: await this.repository.update({
            id: post.id,
            patch: {
              containerId: null,
              containerCreatedAt: null,
              uploadedAt: null,
              publishAttemptedAt: null,
              status: InstagramPostStatus.PENDING,
            },
          }),
        };
      } else if (
        post.publishAttemptedAt &&
        state.statusCode !== ContainerStatusCode.FINISHED
      ) {
        throw this.failure({
          code: InstagramErrorCode.PUBLISH_UNCONFIRMED,
          message: PUBLISH_UNCONFIRMED_MESSAGE,
        });
      }
    }
    return { post };
  }

  private async ensureUploadedContainer({
    post,
    payload,
    progress,
  }: PublishStage): Promise<InstagramPost> {
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
        throw this.failure({
          code: InstagramErrorCode.VIDEO_CHANGED,
          message: '릴스 영상이 변경되었습니다',
        });
      }
      await this.checkQuota();
      const container = await this.graph.createReelContainer(payload.caption);
      const containerPost = await this.repository.update({
        id: post.id,
        patch: {
          containerId: container.containerId,
          containerCreatedAt: new Date(),
          uploadedAt: null,
          publishAttemptedAt: null,
        },
      });
      await this.graph.uploadVideo({ uploadUri: container.uploadUri, video });
      const uploadedPost = await this.repository.update({
        id: containerPost.id,
        patch: { uploadedAt: new Date() },
      });
      await progress?.record('container');
      return uploadedPost;
    }
    return post;
  }

  private async publishContainer({
    post,
    payload,
    progress,
  }: PublishStage): Promise<ApplyResult> {
    const containerId = post.containerId;
    if (!containerId) {
      throw this.failure({
        code: InstagramErrorCode.CONTAINER_FAILED,
        message: '컨테이너가 없습니다',
      });
    }
    const polled = await this.poll(containerId);
    if (polled === ContainerStatusCode.PUBLISHED) {
      return this.finish({ post, payload, progress, issue: null });
    }
    await this.checkQuota();
    const attemptedPost = await this.repository.update({
      id: post.id,
      patch: {
        status: InstagramPostStatus.PUBLISHING,
        publishAttemptedAt: new Date(),
      },
    });
    let published: PublishedMedia;
    try {
      published = await this.graph.publish(containerId);
    } catch (error) {
      if (toInstagramError({ error, code: InstagramErrorCode.TOKEN_INVALID })) {
        throw error;
      }
      const state = await this.settle(containerId);
      if (isClosedWithoutPublish(state.statusCode)) {
        await this.repository.update({
          id: attemptedPost.id,
          patch: { publishAttemptedAt: null },
        });
      }
      try {
        return await this.finish({
          post: attemptedPost,
          payload,
          progress,
          issue: null,
        });
      } catch (settleError) {
        const unconfirmed = toInstagramError({
          error: settleError,
          code: InstagramErrorCode.PUBLISH_UNCONFIRMED,
        });
        const publishFailure =
          error instanceof InstagramException ? error : null;
        if (!unconfirmed || !publishFailure) {
          throw settleError;
        }
        throw this.failure({
          code: InstagramErrorCode.PUBLISH_UNCONFIRMED,
          message: `${unconfirmed.message} (${publishFailure.errorCode}: ${publishFailure.message})`,
        });
      }
    }
    try {
      const publishedPost = await this.repository.update({
        id: attemptedPost.id,
        patch: {
          mediaId: published.mediaId,
        },
      });
      await progress?.record('publish');
      return await this.finish({
        post: publishedPost,
        payload,
        progress,
        issue: published.configIssue,
      });
    } catch (error) {
      throw this.confirmedFailure(error);
    }
  }

  private async finishConfirmed({
    post,
    payload,
    progress,
  }: PublishStage): Promise<ApplyResult> {
    try {
      return await this.finish({ post, payload, progress, issue: null });
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
      throw this.failure({
        code: InstagramErrorCode.QUOTA_EXCEEDED,
        message: '인스타 게시 한도를 초과했습니다',
      });
    }
  }

  private async poll(
    containerId: string,
  ): Promise<ContainerStatusCode.FINISHED | ContainerStatusCode.PUBLISHED> {
    for (let index = 0; index < this.maxPolls; index++) {
      const state = await this.graph.getContainerStatus(containerId);
      if (state.statusCode === ContainerStatusCode.FINISHED) {
        return ContainerStatusCode.FINISHED;
      }
      if (isClosedWithoutPublish(state.statusCode)) {
        throw this.failure({
          code: InstagramErrorCode.CONTAINER_FAILED,
          message: `인스타 영상 처리 실패: ${state.status ?? state.statusCode}`,
        });
      }
      if (state.statusCode === ContainerStatusCode.PUBLISHED) {
        return ContainerStatusCode.PUBLISHED;
      }
      if (index < this.maxPolls - 1) {
        await this.wait(this.pollIntervalMs);
      }
    }
    throw this.failure({
      code: InstagramErrorCode.PROCESSING_TIMEOUT,
      message:
        '인스타가 아직 영상을 처리 중입니다. 잠시 뒤 다시 누르면 이어서 확인합니다',
    });
  }

  private async settle(containerId: string): Promise<ContainerStatus> {
    let state: ContainerStatus = {
      statusCode: ContainerStatusCode.FINISHED,
      status: null,
    };
    for (let index = 0; index < this.settleChecks; index++) {
      await this.wait(this.settleIntervalMs);
      state = await this.graph.getContainerStatus(containerId);
      if (state.statusCode !== ContainerStatusCode.FINISHED) {
        return state;
      }
    }
    return state;
  }

  private async reconcile({
    post,
    payload,
  }: {
    post: InstagramPost;
    payload: ReelPublishPayload;
  }): Promise<RecentMedia | null> {
    const media = await this.graph.listRecentMedia(this.recentMediaLimit);
    const notBeforeMs =
      post.containerCreatedAt === null
        ? null
        : Math.floor(post.containerCreatedAt.getTime() / 1000) * 1000;
    const matches = media.filter((item) =>
      isSamePost({ item, caption: payload.caption, notBeforeMs }),
    );
    if (matches.length > 1) {
      throw this.failure({
        code: InstagramErrorCode.PUBLISH_UNCONFIRMED,
        message:
          '게시 여부를 확인하지 못했습니다. 일치하는 게시물이 여러 개입니다',
      });
    }
    return matches[0] ?? null;
  }

  private async finish({
    post,
    payload,
    progress,
    issue,
  }: PublishStage & { issue: string | null }): Promise<ApplyResult> {
    if (post.mediaId) {
      const detail = await this.graph.getMedia(post.mediaId);
      return this.finishMatched({
        post,
        media: { ...detail, id: post.mediaId },
        progress,
        issue,
      });
    }
    const matched = await this.reconcile({ post, payload });
    if (!matched) {
      throw this.failure({
        code: InstagramErrorCode.PUBLISH_UNCONFIRMED,
        message: PUBLISH_UNCONFIRMED_MESSAGE,
      });
    }
    return this.finishMatched({ post, media: matched, progress, issue });
  }

  private async finishMatched({
    post,
    media,
    progress,
    issue,
  }: {
    post: InstagramPost;
    media: { id: string; permalink: string; timestamp: string };
    progress?: ApplyProgress;
    issue: string | null;
  }): Promise<ApplyResult> {
    await this.repository.update({
      id: post.id,
      patch: {
        mediaId: media.id,
        permalink: media.permalink,
        publishedAt: new Date(media.timestamp),
        status: InstagramPostStatus.PUBLISHED,
        lastError: null,
      },
    });
    await progress?.record('finish');
    return this.result({ permalink: media.permalink, issue });
  }

  private result({
    permalink,
    issue,
  }: {
    permalink: string;
    issue: string | null;
  }): ApplyResult {
    const warning = issue ? ` (주의: ${issue})` : '';
    return {
      message: `인스타에 올렸어요: ${permalink}${warning}`,
      artifacts: [],
    };
  }
  private failure({
    code,
    message,
  }: {
    code: InstagramErrorCode;
    message: string;
  }): InstagramException {
    return new InstagramException({ code, message });
  }
  private async wait(milliseconds: number): Promise<void> {
    if (milliseconds > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    }
  }
}
