import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { InstagramException } from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import { isClosedWithoutPublish } from '../domain/instagram-post.policy';
import {
  InstagramPost,
  InstagramPostField,
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

export enum StoryPublishResult {
  // 다른 실행이 임대를 잡고 있다.
  LOCKED = 'LOCKED',
  // 이전 실행에서 이미 게시 완료·확인 필요로 끝났다. 알림은 상태가 바뀐 실행에서 한 번만 낸다.
  DONE = 'DONE',
  PENDING = 'PENDING',
  PUBLISHED = 'PUBLISHED',
  UNCONFIRMED = 'UNCONFIRMED',
  FAILED = 'FAILED',
}

export type StoryPublishOutcome =
  | { kind: StoryPublishResult.LOCKED }
  | { kind: StoryPublishResult.DONE }
  | { kind: StoryPublishResult.PENDING; reason: string }
  | { kind: StoryPublishResult.PUBLISHED }
  | { kind: StoryPublishResult.UNCONFIRMED }
  | { kind: StoryPublishResult.FAILED; reason: string };

export interface PublishStoryInput {
  day: string;
  reelPreviewId: string;
  story: StoryVideo;
  // 그날 마지막 조회 슬롯이면 확인되지 않은 게시 시도를 종결한다.
  isLastSlot: boolean;
}

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
  // 한 실행의 최대 길이(업로드 120초 ×3 + 재시도 대기 90초 + 폴링 5분 + Graph 호출 몇 번 ≈ 13분)보다 길고,
  // 죽은 실행이 다음 슬롯을 막지 않게 15분.
  leaseSeconds = 900;
  pollIntervalMs = 60_000;
  maxPolls = 5;
  // 릴스 applier 와 같은 이유(Meta 업로드 서버의 불규칙한 ProcessingFailedError)로 새 컨테이너로 다시 올린다.
  // 몰린 장애는 다음 슬롯(15분 뒤)이 다시 시도하므로, 여기서는 임대 안에 끝나는 짧은 간격만 둔다.
  uploadRetryDelaysMs: readonly number[] = [30_000, 60_000];

  constructor(
    @Inject(INSTAGRAM_POST_REPOSITORY_PORT)
    private readonly repository: InstagramPostRepositoryPort,
    @Inject(META_GRAPH_PORT) private readonly graph: MetaGraphPort,
    private readonly lease: CronIdempotencyService,
  ) {}

  async execute(input: PublishStoryInput): Promise<StoryPublishOutcome> {
    // 끝난 스토리는 임대·원장 쓰기 없이 바로 돌려준다. 전날 것까지 15분마다 보므로 대부분의 호출이 여기서 끝난다.
    const existing = await this.repository.findByReelKey(storyKey(input.day));
    if (existing && isSettled(existing)) {
      return { kind: StoryPublishResult.DONE };
    }
    const leaseKey = `instagram-story:${input.day}`;
    if (!(await this.lease.acquireOnce(leaseKey, this.leaseSeconds))) {
      return { kind: StoryPublishResult.LOCKED };
    }
    try {
      return await this.run(input);
    } catch (error) {
      const reason = messageOf(error);
      this.logger.warn(`${input.day} 스토리 게시 실패: ${reason}`);
      await this.recordError({ day: input.day, reason });
      return { kind: StoryPublishResult.FAILED, reason };
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
      field: InstagramPostField.STORY,
      title: STORY_TITLE,
      videoPath: story.videoPath,
      videoSha256: story.videoSha256,
      caption: '',
      previewActionId: reelPreviewId,
    });
    if (isSettled(claimed)) {
      return { kind: StoryPublishResult.DONE };
    }
    if (claimed.publishAttemptedAt) {
      return await this.settleAttempt({ post: claimed, isLastSlot });
    }
    const uploaded = await this.ensureUploaded({ post: claimed, story });
    const containerId = requireContainer(uploaded);
    const polled = await this.poll(containerId);
    if (polled === ContainerStatusCode.IN_PROGRESS) {
      return {
        kind: StoryPublishResult.PENDING,
        reason: '인스타가 아직 스토리 영상을 처리 중',
      };
    }
    if (polled === ContainerStatusCode.PUBLISHED) {
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
      const reason = `게시 응답 없음: ${messageOf(error)}`;
      return await this.holdOrClose({ post: attempting, reason, isLastSlot });
    }
  }

  private async settleAttempt({
    post,
    isLastSlot,
  }: {
    post: InstagramPost;
    isLastSlot: boolean;
  }): Promise<StoryPublishOutcome> {
    const statusCode = await this.statusForSettle({ post, isLastSlot });
    if (statusCode === ContainerStatusCode.PUBLISHED) {
      return await this.finish({ post, mediaId: post.mediaId });
    }
    const reason = `게시를 시도했지만 컨테이너가 ${statusCode} 로 남음`;
    return await this.holdOrClose({ post, reason, isLastSlot });
  }

  // 마지막 슬롯의 조회 실패도 사람에게 넘긴다. 예외로 두면 failed 로 끝나 알림 없이 방치된다(2026-11-05 codex review).
  private async statusForSettle({
    post,
    isLastSlot,
  }: {
    post: InstagramPost;
    isLastSlot: boolean;
  }): Promise<string> {
    try {
      const state = await this.graph.getContainerStatus(requireContainer(post));
      return state.statusCode;
    } catch (error) {
      if (!isLastSlot) {
        throw error;
      }
      return `조회 실패(${messageOf(error)})`;
    }
  }

  // 게시 결과를 확정하지 못했을 때: 마지막 슬롯이면 확인 필요로 종결하고, 아니면 다음 슬롯에 맡긴다.
  private async holdOrClose({
    post,
    reason,
    isLastSlot,
  }: {
    post: InstagramPost;
    reason: string;
    isLastSlot: boolean;
  }): Promise<StoryPublishOutcome> {
    const lastError = isLastSlot
      ? `${STORY_UNCONFIRMED_PREFIX} ${reason}`
      : reason;
    await this.repository.update({ id: post.id, patch: { lastError } });
    if (isLastSlot) {
      return { kind: StoryPublishResult.UNCONFIRMED };
    }
    return { kind: StoryPublishResult.PENDING, reason };
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
    const video = await readApprovedVideo(story);
    await this.checkQuota();
    const created = await this.uploadToNewContainer({ post, video });
    return await this.repository.update({
      id: created.id,
      patch: { uploadedAt: new Date() },
    });
  }

  // 게시 전 단계라 새 컨테이너로 다시 해도 중복 게시 위험이 없다. 토큰 오류처럼 다시 해도 같은 실패는 바로 던진다.
  private async uploadToNewContainer({
    post,
    video,
  }: {
    post: InstagramPost;
    video: Buffer;
  }): Promise<InstagramPost> {
    for (let attempt = 1; ; attempt += 1) {
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
      try {
        await this.graph.uploadVideo({ uploadUri: container.uploadUri, video });
        return created;
      } catch (error) {
        const retriable =
          error instanceof InstagramException &&
          error.errorCode === InstagramErrorCode.GRAPH_REQUEST_FAILED;
        const delayMs = this.uploadRetryDelaysMs[attempt - 1];
        if (!retriable || delayMs === undefined) {
          throw error;
        }
        this.logger.warn(
          `스토리 업로드 실패 ${attempt}회 container=${container.containerId} — ${delayMs / 1000}초 뒤 새 컨테이너로 다시: ${error.message}`,
        );
        await this.wait(delayMs);
      }
    }
  }

  // 처리가 끝나면 FINISHED, 이미 게시됐으면 PUBLISHED, 횟수를 다 써도 처리 중이면 IN_PROGRESS.
  // 호출 사이에 기다려야 하고 결과가 나오면 바로 멈춰야 해서 차례로 도는 반복으로 둔다.
  private async poll(containerId: string): Promise<ContainerStatusCode> {
    for (let attempt = 1; attempt <= this.maxPolls; attempt++) {
      const state = await this.graph.getContainerStatus(containerId);
      if (
        state.statusCode === ContainerStatusCode.FINISHED ||
        state.statusCode === ContainerStatusCode.PUBLISHED
      ) {
        return state.statusCode;
      }
      if (isClosedWithoutPublish(state.statusCode)) {
        throw failure(
          InstagramErrorCode.CONTAINER_FAILED,
          `인스타 스토리 처리 실패: ${state.status ?? state.statusCode}`,
        );
      }
      if (attempt < this.maxPolls) {
        await this.wait(this.pollIntervalMs);
      }
    }
    return ContainerStatusCode.IN_PROGRESS;
  }

  private async finish({
    post,
    mediaId,
  }: {
    post: InstagramPost;
    mediaId: string | null;
  }): Promise<StoryPublishOutcome> {
    const permalink = mediaId ? await this.findPermalink(mediaId) : null;
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
    return { kind: StoryPublishResult.PUBLISHED };
  }

  // 게시는 이미 확정됐다. 스토리는 24시간 뒤 사라져 permalink 가 없어도 기록을 막지 않는다.
  private async findPermalink(mediaId: string): Promise<string | null> {
    try {
      const media = await this.graph.getMedia(mediaId);
      return media.permalink;
    } catch (error) {
      this.logger.warn(`스토리 permalink 조회 실패: ${messageOf(error)}`);
      return null;
    }
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
      if (found && !isSettled(found)) {
        await this.repository.update({
          id: found.id,
          patch: { lastError: reason.slice(0, 500) },
        });
      }
    } catch (error) {
      this.logger.warn(`스토리 실패 사유 기록 실패: ${messageOf(error)}`);
    }
  }

  protected async wait(milliseconds: number): Promise<void> {
    if (milliseconds > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    }
  }
}

const storyKey = (day: string): string => `${day}/story`;

const isSettled = (post: InstagramPost): boolean => {
  if (post.status === InstagramPostStatus.PUBLISHED) {
    return true;
  }
  return post.lastError?.startsWith(STORY_UNCONFIRMED_PREFIX) === true;
};

// 승인한 파일과 올리는 파일이 같아야 한다. 읽은 버퍼를 해시하고 그 버퍼를 그대로 올린다.
const readApprovedVideo = async (story: StoryVideo): Promise<Buffer> => {
  const video = await readVideo(story.videoPath);
  const digest = createHash('sha256').update(video).digest('hex');
  if (digest !== story.videoSha256) {
    throw failure(
      InstagramErrorCode.VIDEO_CHANGED,
      '스토리 영상이 변경되었습니다',
    );
  }
  return video;
};

const readVideo = async (videoPath: string): Promise<Buffer> => {
  try {
    return await readFile(videoPath);
  } catch {
    throw failure(
      InstagramErrorCode.VIDEO_MISSING,
      '스토리 영상 파일이 없습니다',
    );
  }
};

const requireContainer = (post: InstagramPost): string => {
  if (!post.containerId) {
    throw failure(
      InstagramErrorCode.CONTAINER_FAILED,
      '스토리 컨테이너 기록이 없습니다',
    );
  }
  return post.containerId;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const failure = (
  code: InstagramErrorCode,
  message: string,
): InstagramException => new InstagramException({ code, message });
