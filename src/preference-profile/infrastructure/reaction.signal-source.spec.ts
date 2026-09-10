import { ReactionSignalRow } from '../domain/port/reaction-signal.repository.port';
import { ReactionSignalSource } from './reaction.signal-source';

const makeRow = (
  overrides: Partial<ReactionSignalRow> = {},
): ReactionSignalRow => ({
  id: 1,
  emoji: '+1',
  messageText: '오늘 오전 브리핑 보냅니다',
  ...overrides,
});

describe('ReactionSignalSource', () => {
  it('긍정 이모지(+1)는 [좋아함] 라벨로 매핑한다', async () => {
    const repository = {
      record: jest.fn(),
      recentReactions: jest
        .fn()
        .mockResolvedValue([makeRow({ id: 9, emoji: '+1' })]),
    };
    const source = new ReactionSignalSource(repository as never);
    const signals = await source.fetch('U1', Date.now() - 86400_000);

    expect(signals).toEqual([
      {
        source: 'reaction',
        evidenceRef: 'slackReaction:9',
        observedText: '[좋아함] 오늘 오전 브리핑 보냅니다',
      },
    ]);
  });

  it('긍정 이모지(thumbsup)도 [좋아함] 라벨로 매핑한다', async () => {
    const repository = {
      record: jest.fn(),
      recentReactions: jest
        .fn()
        .mockResolvedValue([makeRow({ id: 10, emoji: 'thumbsup' })]),
    };
    const source = new ReactionSignalSource(repository as never);
    const signals = await source.fetch('U1', 0);

    expect(signals[0].observedText).toBe('[좋아함] 오늘 오전 브리핑 보냅니다');
  });

  it('부정 이모지(-1)는 [싫어함] 라벨로 매핑한다', async () => {
    const repository = {
      record: jest.fn(),
      recentReactions: jest
        .fn()
        .mockResolvedValue([makeRow({ id: 11, emoji: '-1' })]),
    };
    const source = new ReactionSignalSource(repository as never);
    const signals = await source.fetch('U1', 0);

    expect(signals[0]).toEqual({
      source: 'reaction',
      evidenceRef: 'slackReaction:11',
      observedText: '[싫어함] 오늘 오전 브리핑 보냅니다',
    });
  });

  it('부정 이모지(thumbsdown)도 [싫어함] 라벨로 매핑한다', async () => {
    const repository = {
      record: jest.fn(),
      recentReactions: jest
        .fn()
        .mockResolvedValue([makeRow({ id: 12, emoji: 'thumbsdown' })]),
    };
    const source = new ReactionSignalSource(repository as never);
    const signals = await source.fetch('U1', 0);

    expect(signals[0].observedText).toBe('[싫어함] 오늘 오전 브리핑 보냅니다');
  });

  it('메시지 본문이 300자를 넘으면 자른다', async () => {
    const repository = {
      record: jest.fn(),
      recentReactions: jest
        .fn()
        .mockResolvedValue([
          makeRow({ id: 13, emoji: '+1', messageText: '가'.repeat(500) }),
        ]),
    };
    const source = new ReactionSignalSource(repository as never);
    const signals = await source.fetch('U1', 0);

    expect(signals[0].observedText).toBe(`[좋아함] ${'가'.repeat(300)}`);
  });

  it('recentReactions 가 빈 배열이면 빈 신호를 반환한다', async () => {
    const repository = {
      record: jest.fn(),
      recentReactions: jest.fn().mockResolvedValue([]),
    };
    const source = new ReactionSignalSource(repository as never);
    const signals = await source.fetch('U1', 0);
    expect(signals).toEqual([]);
  });
});
