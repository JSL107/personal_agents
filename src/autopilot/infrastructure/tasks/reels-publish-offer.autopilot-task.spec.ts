import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';

import {
  PublishStoryUsecase,
  StoryPublishOutcome,
  StoryPublishResult,
} from '../../../instagram/application/publish-story.usecase';
import {
  InstagramPost,
  InstagramPostStatus,
} from '../../../instagram/domain/instagram-post.type';
import { InstagramPostRepositoryPort } from '../../../instagram/domain/port/instagram-post.repository.port';
import { MetaGraphPort } from '../../../instagram/domain/port/meta-graph.port';
import { CountPreviewsByPayloadUsecase } from '../../../preview-gate/application/count-previews-by-payload.usecase';
import { FindPreviewByIdUsecase } from '../../../preview-gate/application/find-preview-by-id.usecase';
import { PreviewAction } from '../../../preview-gate/domain/preview-action.type';
import { ReelsPublishOfferAutopilotTask } from './reels-publish-offer.autopilot-task';

const DAY = '2026-11-06';
const CONTEXT = { ownerSlackUserId: 'owner', firedAtKst: DAY };
const STORY = {
  videoPath: '/story.mp4',
  videoSha256: 'a'.repeat(64),
  videoBytes: 5,
};
const approvedPayload = {
  reelKey: `${DAY}/daily`,
  field: 'daily',
  title: 't',
  videoPath: '/reel.mp4',
  videoSha256: 'b'.repeat(64),
  videoBytes: 9,
  caption: 'c',
  durationSec: 58,
  story: STORY,
};

describe('ReelsPublishOfferAutopilotTask', () => {
  let root: string;
  const meta = { isConfigured: jest.fn(() => true) };
  const repository = {
    findByReelKey: jest
      .fn<Promise<InstagramPost | null>, [string]>()
      .mockResolvedValue(null),
  };
  const count = {
    execute: jest
      .fn<Promise<number>, [{ payloadPath: string[]; payloadValue: string }]>()
      .mockResolvedValue(0),
  };
  const findPreview = {
    execute: jest.fn<Promise<PreviewAction | null>, [string]>(),
  };
  const publishStory = {
    execute: jest.fn<Promise<StoryPublishOutcome>, [unknown]>(),
  };
  const config = { get: jest.fn(() => root) };

  const makeTask = (nowIso = '2026-11-06T03:00:00Z') => {
    const task = new ReelsPublishOfferAutopilotTask(
      meta as unknown as MetaGraphPort,
      repository as unknown as InstagramPostRepositoryPort,
      count as unknown as CountPreviewsByPayloadUsecase,
      findPreview as unknown as FindPreviewByIdUsecase,
      publishStory as unknown as PublishStoryUsecase,
      config as unknown as ConfigService,
    );
    task.now = () => new Date(nowIso);
    return task;
  };

  const addDaily = async ({
    caption = '하루 캡션',
    segments = ['ai', 'dev'],
    withStory = true,
  } = {}) => {
    const directory = join(root, DAY, 'daily');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'done.json'), '{}');
    await writeFile(join(directory, 'reel.mp4'), Buffer.from('reel'));
    await writeFile(join(directory, 'caption.txt'), caption);
    if (withStory) {
      await writeFile(join(directory, 'story.mp4'), Buffer.from('story'));
    }
    await writeFile(
      join(directory, 'script.json'),
      JSON.stringify({
        title: '이제 평가를 의심해요 · 버그를 먼저 찾아 줘요',
        duration: 58.4,
        cover_offset_ms: 58_150,
        segments: segments.map((field) => ({ field })),
      }),
    );
  };

  const publishedReel = (): InstagramPost =>
    ({
      id: 'post',
      reelKey: `${DAY}/daily`,
      status: InstagramPostStatus.PUBLISHED,
      previewActionId: 'card',
    }) as InstagramPost;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'reels-offer-'));
    jest.clearAllMocks();
    meta.isConfigured.mockReturnValue(true);
    repository.findByReelKey.mockResolvedValue(null);
    count.execute.mockResolvedValue(0);
    findPreview.execute.mockResolvedValue({
      id: 'card',
      payload: approvedPayload,
    } as unknown as PreviewAction);
    publishStory.execute.mockResolvedValue({
      kind: StoryPublishResult.PUBLISHED,
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('미설정이면 skip 한다', async () => {
    meta.isConfigured.mockReturnValue(false);
    await expect(makeTask().run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('하루 1편이면 카드 한 장에 두 분야·표지·스토리 안내를 싣는다', async () => {
    await addDaily();
    const result = await makeTask().run(CONTEXT);

    expect(result.previews).toHaveLength(1);
    expect(result.previews?.[0].payload).toEqual(
      expect.objectContaining({
        reelKey: `${DAY}/daily`,
        field: 'daily',
        coverOffsetMs: 58_150,
        story: expect.objectContaining({ videoBytes: 5 }),
      }),
    );
    const text = result.previews?.[0].previewText ?? '';
    expect(text.split('\n')[0]).toBe(
      '📮 *인스타 공개 게시* · 「이제 평가를 의심해요 · 버그를 먼저 찾아 줘요」 · @skill.jaengyi 에 바로 올라갑니다',
    );
    expect(text).toContain('분야 AI·개발 · 58초');
    expect(text).toContain('표지: 영상 58.1초 지점');
    expect(text).toContain(
      '스토리(오늘의 한 줄 카드, 8초)도 이어서 올라갑니다.',
    );
    expect(result.guardKeySuffix).toMatch(
      new RegExp(`^card:${DAY}/daily:[0-9a-f]{12}$`),
    );
  });

  it('한 꼭지만 있는 날은 그 분야만 적고, 스토리가 없으면 안내를 뺀다', async () => {
    await addDaily({ segments: ['ai'], withStory: false });
    const text = (await makeTask().run(CONTEXT)).previews?.[0].previewText;

    expect(text).toContain('분야 AI · 58초');
    expect(text).not.toContain('스토리');
  });

  it('같은 영상 해시로 낸 카드가 있으면(취소 포함) 다시 내지 않는다', async () => {
    await addDaily();
    count.execute.mockResolvedValue(1);

    await expect(makeTask().run(CONTEXT)).resolves.toEqual({ skip: true });
    expect(count.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadPath: ['videoSha256'],
        payloadValue: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it('tooLong은 카드 없이 게시 불가 요약을 낸다', async () => {
    await addDaily({ caption: 'x'.repeat(2201) });
    const result = await makeTask().run(CONTEXT);
    expect(result.previews).toEqual([]);
    expect(result.summaryText).toContain(
      `게시 불가: ${DAY}/daily 캡션 2201자(2,200자 초과)`,
    );
    expect(result.guardKeySuffix).toBe(`long:${DAY}/daily`);
  });

  it('릴스가 게시되고 카드가 스토리를 승인했으면 스토리를 이어 올리고 알린다', async () => {
    repository.findByReelKey.mockImplementation(async (key) =>
      key === `${DAY}/daily` ? publishedReel() : null,
    );

    const result = await makeTask().run(CONTEXT);

    expect(publishStory.execute).toHaveBeenCalledWith({
      day: DAY,
      reelPreviewId: 'card',
      story: STORY,
      isLastSlot: false,
    });
    expect(result.summaryText).toBe(
      `${DAY} 「오늘의 한 줄」 스토리도 올라갔습니다.`,
    );
    expect(result.guardKeySuffix).toBe(`story:${DAY}:published`);
  });

  it('전날 릴스가 다음 날 승인·게시됐어도 그 스토리를 이어 올린다', async () => {
    repository.findByReelKey.mockImplementation(async (key) =>
      key === '2026-11-05/daily'
        ? { ...publishedReel(), reelKey: '2026-11-05/daily' }
        : null,
    );

    const result = await makeTask().run(CONTEXT);

    expect(publishStory.execute).toHaveBeenCalledTimes(1);
    expect(publishStory.execute).toHaveBeenCalledWith(
      expect.objectContaining({ day: '2026-11-05' }),
    );
    expect(result.guardKeySuffix).toBe('story:2026-11-05:published');
  });

  it('릴스가 아직 게시되지 않았으면 스토리를 올리지 않는다', async () => {
    repository.findByReelKey.mockResolvedValue({
      ...publishedReel(),
      status: InstagramPostStatus.PUBLISHING,
    });

    await makeTask().run(CONTEXT);

    expect(publishStory.execute).not.toHaveBeenCalled();
  });

  it('승인된 카드에 스토리가 없으면 올리지 않는다', async () => {
    repository.findByReelKey.mockResolvedValue(publishedReel());
    findPreview.execute.mockResolvedValue({
      id: 'card',
      payload: { ...approvedPayload, story: undefined },
    } as unknown as PreviewAction);

    await expect(makeTask().run(CONTEXT)).resolves.toEqual({ skip: true });
    expect(publishStory.execute).not.toHaveBeenCalled();
  });

  it('스토리 대기는 알리지 않고, 실패는 하루 한 번 알리며, 예외가 나도 task 는 throw 하지 않는다', async () => {
    repository.findByReelKey.mockImplementation(async (key) =>
      key === `${DAY}/daily` ? publishedReel() : null,
    );
    publishStory.execute.mockResolvedValue({
      kind: StoryPublishResult.PENDING,
      reason: '처리 중',
    });
    await expect(makeTask().run(CONTEXT)).resolves.toEqual({ skip: true });

    publishStory.execute.mockResolvedValue({
      kind: StoryPublishResult.FAILED,
      reason: '스토리 영상이 변경되었습니다',
    });
    const failed = await makeTask().run(CONTEXT);
    expect(failed.summaryText).toContain(
      `${DAY} 스토리 게시 실패: 스토리 영상이 변경되었습니다`,
    );
    expect(failed.guardKeySuffix).toBe(`story:${DAY}:failed`);

    publishStory.execute.mockRejectedValue(new Error('boom'));
    await expect(makeTask().run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('23:45 슬롯이면 마지막 슬롯으로 넘기고, 확인 필요는 따로 알린다', async () => {
    repository.findByReelKey.mockImplementation(async (key) =>
      key === `${DAY}/daily` ? publishedReel() : null,
    );
    publishStory.execute.mockResolvedValue({
      kind: StoryPublishResult.UNCONFIRMED,
    });

    const result = await makeTask('2026-11-06T14:45:00Z').run(CONTEXT);

    expect(publishStory.execute).toHaveBeenCalledWith(
      expect.objectContaining({ isLastSlot: true }),
    );
    expect(result.summaryText).toContain('스토리 게시 여부 확인 필요');
    expect(result.guardKeySuffix).toBe(`story:${DAY}:unconfirmed`);
  });
});
