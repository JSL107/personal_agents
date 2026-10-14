import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';

import { ArtJobPostingRepositoryPort } from '../../art-job-feed/domain/port/art-job-posting.repository.port';
import { ArtJobExclusionReactionHandler } from './art-job-exclusion-reaction.handler';

type ReactionEvent = {
  reaction: string;
  user?: string;
  item: { type: string; channel: string; ts: string };
};

type EventHandler = (input: { event: ReactionEvent }) => Promise<void>;

const CONFIG: Record<string, string> = {
  ART_JOB_FEED_TARGET: 'C_ART',
  ART_JOB_FEED_MENTION_USER_ID: 'U_RECIPIENT',
};

const buildHarness = (config: Record<string, string> = CONFIG) => {
  let handler: EventHandler | undefined;
  const app = {
    event: jest.fn((_name: string, callback: EventHandler) => {
      handler = callback;
    }),
  } as unknown as App;
  const markExcluded = jest
    .fn()
    .mockResolvedValue({ company: '회사', title: '캐릭터 원화' });
  const repository = {
    markExcluded,
  } as unknown as ArtJobPostingRepositoryPort;
  const configService = {
    get: (key: string) => config[key],
  } as unknown as ConfigService;
  new ArtJobExclusionReactionHandler(configService, repository).register(app);
  return { app, handler, markExcluded };
};

const baseEvent: ReactionEvent = {
  reaction: 'three',
  user: 'U_RECIPIENT',
  item: { type: 'message', channel: 'C_ART', ts: '100.001' },
};

describe('ArtJobExclusionReactionHandler', () => {
  it('받는 사람이 번호 이모지를 달면 그 번호 공고를 제외로 표시한다', async () => {
    const { handler, markExcluded } = buildHarness();

    await handler?.({ event: baseEvent });

    expect(markExcluded).toHaveBeenCalledWith({
      messageTs: '100.001',
      digestOrder: 3,
    });
  });

  it.each([
    ['one', 1],
    ['two', 2],
    ['three', 3],
    ['four', 4],
    ['five', 5],
    ['six', 6],
    ['seven', 7],
    ['eight', 8],
    ['nine', 9],
    ['keycap_ten', 10],
  ])('%s 이모지는 %i번 공고로 읽는다', async (reaction, digestOrder) => {
    const { handler, markExcluded } = buildHarness();

    await handler?.({ event: { ...baseEvent, reaction } });

    expect(markExcluded).toHaveBeenCalledWith({
      messageTs: '100.001',
      digestOrder,
    });
  });

  it.each([
    ['숫자가 아닌 이모지', { ...baseEvent, reaction: '-1' }],
    ['받는 사람이 아닌 사용자', { ...baseEvent, user: 'U_OTHER' }],
    ['사용자 누락', { ...baseEvent, user: undefined }],
    [
      '다른 채널',
      { ...baseEvent, item: { ...baseEvent.item, channel: 'C_OTHER' } },
    ],
    ['비메시지', { ...baseEvent, item: { ...baseEvent.item, type: 'file' } }],
  ])('%s 의 반응은 건너뛴다', async (_label, event) => {
    const { handler, markExcluded } = buildHarness();

    await handler?.({ event });

    expect(markExcluded).not.toHaveBeenCalled();
  });

  it('받는 사람이 설정되지 않으면 리액션을 듣지 않는다', () => {
    const { app } = buildHarness({ ART_JOB_FEED_TARGET: 'C_ART' });

    expect(app.event).not.toHaveBeenCalled();
  });

  it('장부 저장이 실패해도 던지지 않는다', async () => {
    const { handler, markExcluded } = buildHarness();
    markExcluded.mockRejectedValueOnce(new Error('db down'));

    await expect(handler?.({ event: baseEvent })).resolves.toBeUndefined();
  });
});
