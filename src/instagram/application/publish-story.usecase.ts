import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { InstagramException } from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import { isClosedWithoutPublish } from '../domain/instagram-post.policy';
import {
  InstagramPost,
  InstagramPostStatus,
  StoryVideo,
} from '../domain/instagram-post.type';
import {
  INSTAGRAM_POST_REPOSITORY_PORT,
  InstagramPostRepositoryPort,
} from '../domain/port/instagram-post.repository.port';
import {
  ContainerStatusCode,
  META_GRAPH_PORT,
  MetaGraphPort,
} from '../domain/port/meta-graph.port';

const STORY_TITLE = '오늘의 한 줄 스토리';
// 이 접두사로 시작하는 lastError 는 "게시 여부를 사람이 확인해야 함" 종결 표시다. 그 뒤로는 Meta 를 부르지 않는다.
export const STORY_UNCONFIRMED_PREFIX = 'UNCONFIRMED:';

export type StoryPublishOutcome =
  | { kind: 'locked' }
  // 이전 실행에서 이미 게시 완료·확인 필요로 끝났다. 알림은 상태가 바뀐 실행에서 한 번만 낸다.
  | { kind: 'done' }
  | { kind: 'pending'; reason: string }
  | { kind: 'published' }
  | { kind: 'unconfirmed' }
  | { kind: 'failed'; reason: string };

export interface PublishStoryInput {
  day: string;
  reelPreviewId: string;
  story: StoryVideo;
  // 그날 마지막 조회 슬롯이면 확인되지 않은 게시 시도를 종결한다.
  isLastSlot: boolean;
}

type PollResult = 'ready' | 'published' | 'processing';

// 릴스 카드 승인으로 함께 승인된 「오늘의 한 줄」 스토리를 한 번만 올린다. offer task 가 15분마다 부른다.
//
// 릴스 applier 와 다른 점(2026-11-05 교차 검토):
// - 카드 apply 의 잠금(beginApply)을 거치지 않으므로 Redis 임대로 한 번에 한 실행만 돈다.
// - 스토리는 캡션이 없고 /media 목록에도 안 나와 게시물 대조가 불가능하다. 그래서 게시를 한 번 시도한 뒤에는
//   절대 다시 publish 하지 않는다. 확정 근거는 publish 응답의 mediaId 또는 컨테이너 PUBLISHED 둘뿐이고,
//   그날 끝까지 확정되지 않으면 사람에게 넘긴다. 결과는 "스토리 하나가 빠질 수 있음"이지 "두 번 올라감"이 아니다.
// - 어떤 실패도 throw 하지 않는다. 던지면 autopilot 이 60초 뒤 슬롯 전체를 다시 돌린다.
@Injectable()
export class PublishStoryUsecase {
  private readonly logger = new Logger(PublishStoryUsecase.name);
  // 한 실행의 최대 길이(업로드 120초 + 폴링 5분 + Graph 호출 몇 번)보다 길고, 죽은 실행이 다음 슬롯을 막지 않게 15분.
  leaseSeconds = 900;
  pollIntervalMs = 60_000;
  maxPolls = 5;

  constructor(
    @Inject(INSTAGRAM_POST_REPOSITORY_PORT)
    private readonly repository: InstagramPostRepositoryPort,
    @Inject(META_GRAPH_PORT) private readonly graph: MetaGraphPort,
    private readonly lease: CronIdempotencyService,
  ) {}

  async execute(input: PublishStoryInput): Promise<StoryPublishOutcome> {
    const leaseKey = `instagram-story:${input.day}`;
    if (!(await this.lease.acquireOnce(leaseKey, this.leaseSeconds))) {
      return { kind: 'locked' };
    }
    try {
      return await this.run(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${input.day} 스토리 게시 실패: ${reason}`);
      await this.recordError({ day: input.day, reason });
      return { kind: 'failed', reason };
    } finally {
      await this.lease.release(leaseKey);
    }
  }

  private async run({
    day,
    reelPreviewId,
    story,
    isLastSlot,
  }: PublishStoryInput): Promise<StoryPublishOutcome> {
    const claimed = await this.repository.upsertByReelKey({
      reelKey: storyKey(day),
      field: 'story',
      title: STORY_TITLE,
      videoPath: story.videoPath,
      videoSha256: story.videoSha256,
      caption: '',
      previewActionId: reelPreviewId,
    });
    if (
      claimed.status === InstagramPostStatus.PUBLISHED ||
      claimed.lastError?.startsWith(STORY_UNCONFIRMED_PREFIX)
    ) {
      return { kind: 'done' };
    }
    if (claimed.publishAttemptedAt) {
      return await this.settleAttempt({ post: claimed, isLastSlot });
    }
    const uploaded = await this.ensureUploaded({ post: claimed, story });
    const containerId = requireContainer(uploaded);
    const polled = await this.poll(containerId);
    if (polled === 'processing') {
      return { kind: 'pending', reason: '인스타가 아직 스토리 영상을 처리 중' };
    }
    if (polled === 'published') {
      return await this.finish({ post: uploaded, mediaId: null });
    }
    await this.checkQuota();
    const attempting = await this.repository.update({
      id: uploaded.id,
      patch: {
        status: InstagramPostStatus.PUBLISHING,
        publishAttemptedAt: new Date(),
      },
    });
    try {
      const published = await this.graph.publish(containerId);
      return await this.finish({
        post: attempting,
        mediaId: published.mediaId,
      });
    } catch (error) {
      // 응답을 못 받았어도 올라갔을 수 있다. 다시 publish 하지 않고 다음 슬롯이 컨테이너 상태로 정산한다.
      // 마지막 슬롯이면 정산할 다음 슬롯이 없으니 바로 사람에게 넘긴다(2026-11-05 codex review).
      const reason = error instanceof Error ? error.message : String(error);
      await this.repository.update({
        id: attempting.id,
        patch: {
          lastError: isLastSlot
            ? `${STORY_UNCONFIRMED_PREFIX} 게시 응답 없음: ${reason}`
            : `게시 응답 없음: ${reason}`,
        },
      });
      if (isLastSlot) {
        return { kind: 'unconfirmed' };
      }
      return { kind: 'pending', reason: `게시 응답 없음: ${reason}` };
    }
  }

  private async settleAttempt({
    post,
    isLastSlot,
  }: {
    post: InstagramPost;
    isLastSlot: boolean;
  }): Promise<StoryPublishOutcome> {
    let statusCode: string;
    try {
      statusCode = (await this.graph.getContainerStatus(requireContainer(post)))
        .statusCode;
    } catch (error) {
      // 마지막 슬롯의 조회 실패도 사람에게 넘긴다. failed 로 끝나면 알림 없이 방치된다(2026-11-05 codex review).
      if (!isLastSlot) {
        throw error;
      }
      statusCode = `조회 실패(${error instanceof Error ? error.message : String(error)})`;
    }
    if (statusCode === ContainerStatusCode.PUBLISHED) {
      return await this.finish({ post, mediaId: post.mediaId });
    }
    if (isLastSlot) {
      await this.repository.update({
        id: post.id,
        patch: {
          lastError: `${STORY_UNCONFIRMED_PREFIX} 게시를 시도했지만 컨테이너가 ${statusCode} 로 남음`,
        },
      });
      return { kind: 'unconfirmed' };
    }
    return {
      kind: 'pending',
      reason: `게시 확인 대기(컨테이너 ${statusCode})`,
    };
  }

  private async ensureUploaded({
    post,
    story,
  }: {
    post: InstagramPost;
    story: StoryVideo;
  }): Promise<InstagramPost> {
    if (post.containerId && post.uploadedAt) {
      const state = await this.graph.getContainerStatus(post.containerId);
      if (!isClosedWithoutPublish(state.statusCode)) {
        return post;
      }
    }
    let video: Buffer;
    try {
      video = await readFile(story.videoPath);
    } catch {
      throw failure(
        InstagramErrorCode.VIDEO_MISSING,
        '스토리 영상 파일이 없습니다',
      );
    }
    // 승인한 파일과 올리는 파일이 같아야 한다. 읽은 버퍼를 해시하고 그 버퍼를 그대로 올린다.
    if (
      createHash('sha256').update(video).digest('hex') !== story.videoSha256
    ) {
      throw failure(
        InstagramErrorCode.VIDEO_CHANGED,
        '스토리 영상이 변경되었습니다',
      );
    }
    await this.checkQuota();
    const container = await this.graph.createStoryContainer();
    const created = await this.repository.update({
      id: post.id,
      patch: {
        containerId: container.containerId,
        containerCreatedAt: new Date(),
        uploadedAt: null,
        publishAttemptedAt: null,
      },
    });
    await this.graph.uploadVideo({ uploadUri: container.uploadUri, video });
    return await this.repository.update({
      id: created.id,
      patch: { uploadedAt: new Date() },
    });
  }

  private async poll(containerId: string): Promise<PollResult> {
    for (let index = 0; index < this.maxPolls; index++) {
      const state = await this.graph.getContainerStatus(containerId);
      if (state.statusCode === ContainerStatusCode.FINISHED) {
        return 'ready';
      }
      if (state.statusCode === ContainerStatusCode.PUBLISHED) {
        return 'published';
      }
      if (isClosedWithoutPublish(state.statusCode)) {
        throw failure(
          InstagramErrorCode.CONTAINER_FAILED,
          `인스타 스토리 처리 실패: ${state.status ?? state.statusCode}`,
        );
      }
      if (index < this.maxPolls - 1) {
        await this.wait(this.pollIntervalMs);
      }
    }
    return 'processing';
  }

  private async finish({
    post,
    mediaId,
  }: {
    post: InstagramPost;
    mediaId: string | null;
  }): Promise<StoryPublishOutcome> {
    let permalink: string | null = null;
    if (mediaId) {
      try {
        permalink = (await this.graph.getMedia(mediaId)).permalink;
      } catch (error) {
        // 게시는 확정됐다. 스토리는 24시간 뒤 사라져 permalink 가 없어도 기록을 막지 않는다.
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`스토리 permalink 조회 실패: ${reason}`);
      }
    }
    await this.repository.update({
      id: post.id,
      patch: {
        status: InstagramPostStatus.PUBLISHED,
        mediaId,
        permalink,
        publishedAt: new Date(),
        lastError: null,
      },
    });
    return { kind: 'published' };
  }

  private async checkQuota(): Promise<void> {
    const limit = await this.graph.getPublishingLimit();
    if (limit.usage >= limit.total) {
      throw failure(
        InstagramErrorCode.QUOTA_EXCEEDED,
        '인스타 게시 한도를 초과했습니다',
      );
    }
  }

  private async recordError({
    day,
    reason,
  }: {
    day: string;
    reason: string;
  }): Promise<void> {
    try {
      const found = await this.repository.findByReelKey(storyKey(day));
      if (found && !found.lastError?.startsWith(STORY_UNCONFIRMED_PREFIX)) {
        await this.repository.update({
          id: found.id,
          patch: { lastError: reason.slice(0, 500) },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`스토리 실패 사유 기록 실패: ${message}`);
    }
  }

  protected async wait(milliseconds: number): Promise<void> {
    if (milliseconds > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    }
  }
}

const storyKey = (day: string): string => `${day}/story`;

const requireContainer = (post: InstagramPost): string => {
  if (!post.containerId) {
    throw failure(
      InstagramErrorCode.CONTAINER_FAILED,
      '스토리 컨테이너 기록이 없습니다',
    );
  }
  return post.containerId;
};

const failure = (
  code: InstagramErrorCode,
  message: string,
): InstagramException => new InstagramException({ code, message });
