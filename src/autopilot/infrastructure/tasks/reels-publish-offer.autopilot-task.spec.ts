import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';

import { InstagramPostRepositoryPort } from '../../../instagram/domain/port/instagram-post.repository.port';
import { MetaGraphPort } from '../../../instagram/domain/port/meta-graph.port';
import { CountPreviewsByPayloadUsecase } from '../../../preview-gate/application/count-previews-by-payload.usecase';
import { ReelsPublishOfferAutopilotTask } from './reels-publish-offer.autopilot-task';

const DAY = '2026-11-05';
const CONTEXT = { ownerSlackUserId: 'owner', firedAtKst: DAY };

describe('ReelsPublishOfferAutopilotTask', () => {
  let root: string;
  const meta = { isConfigured: jest.fn(() => true) };
  const repository = {
    findByReelKey: jest.fn<Promise<null>, [string]>().mockResolvedValue(null),
  };
  const count = {
    execute: jest
      .fn<Promise<number>, [{ payloadValue: string }]>()
      .mockResolvedValue(0),
  };
  const config = { get: jest.fn(() => root) };

  const makeTask = () =>
    new ReelsPublishOfferAutopilotTask(
      meta as unknown as MetaGraphPort,
      repository as unknown as InstagramPostRepositoryPort,
      count as unknown as CountPreviewsByPayloadUsecase,
      config as unknown as ConfigService,
    );

  const addReel = async (field: 'ai' | 'dev', caption = `${field} 캡션`) => {
    const directory = join(root, DAY, field);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'done.json'), '{}');
    await writeFile(join(directory, 'reel.mp4'), Buffer.from(field));
    await writeFile(join(directory, 'caption.txt'), caption);
    await writeFile(
      join(directory, 'script.json'),
      JSON.stringify({
        row: { title: field === 'ai' ? 'AI 소식' : '개발 소식' },
        duration: 39.6,
      }),
    );
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'reels-offer-'));
    jest.clearAllMocks();
    meta.isConfigured.mockReturnValue(true);
    repository.findByReelKey.mockResolvedValue(null);
    count.execute.mockResolvedValue(0);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('미설정이면 skip 한다', async () => {
    meta.isConfigured.mockReturnValue(false);
    await expect(makeTask().run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('두 편 신규면 카드 두 장과 정렬된 guardKeySuffix를 낸다', async () => {
    await addReel('ai');
    await addReel('dev');
    const result = await makeTask().run(CONTEXT);
    expect(result.previews).toHaveLength(2);
    expect(result.previews?.map((preview) => preview.payload)).toEqual([
      expect.objectContaining({
        reelKey: `${DAY}/ai`,
        videoSha256: expect.any(String),
      }),
      expect.objectContaining({
        reelKey: `${DAY}/dev`,
        videoSha256: expect.any(String),
      }),
    ]);
    expect(result.guardKeySuffix).toBe(`card:${DAY}/ai,card:${DAY}/dev`);
    expect(result.previews?.[1].previewText.split('\n')[0]).toBe(
      '📮 *인스타 공개 게시* · 「개발 소식」 · @skill.jaengyi 에 바로 올라갑니다',
    );
  });

  it('한 편 카드가 있으면 남은 한 편만 낸다', async () => {
    await addReel('ai');
    await addReel('dev');
    count.execute.mockImplementation(async ({ payloadValue }) =>
      payloadValue === `${DAY}/ai` ? 1 : 0,
    );
    const result = await makeTask().run(CONTEXT);
    expect(result.previews).toHaveLength(1);
    expect(result.guardKeySuffix).toBe(`card:${DAY}/dev`);
  });

  it('원장 행이 있으면 제외하고 전부 제외되면 skip 한다', async () => {
    await addReel('ai');
    repository.findByReelKey.mockResolvedValue({ id: 'post' } as never);
    await expect(makeTask().run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('tooLong은 카드 없이 게시 불가 요약을 낸다', async () => {
    await addReel('ai', 'x'.repeat(2201));
    const result = await makeTask().run(CONTEXT);
    expect(result.previews).toEqual([]);
    expect(result.summaryText).toContain(
      `게시 불가: ${DAY}/ai 캡션 2201자(2,200자 초과)`,
    );
    expect(result.guardKeySuffix).toBe(`long:${DAY}/ai`);
  });

  it('같은 릴스가 게시 불가에서 승인 가능으로 바뀌면 발송 키가 달라진다', async () => {
    await addReel('ai', 'x'.repeat(2201));
    const tooLongResult = await makeTask().run(CONTEXT);

    await writeFile(join(root, DAY, 'ai', 'caption.txt'), '게시 가능 캡션');
    const readyResult = await makeTask().run(CONTEXT);

    expect(tooLongResult.guardKeySuffix).toBe(`long:${DAY}/ai`);
    expect(readyResult.guardKeySuffix).toBe(`card:${DAY}/ai`);
  });
});
