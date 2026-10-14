import { describeEnabledPassiveCapabilities } from './passive-capability';

const reader =
  (env: Record<string, string>) =>
  (key: string): string | undefined =>
    env[key];

describe('describeEnabledPassiveCapabilities', () => {
  it('env 가 없으면 항상 켜진 이모지 기능(✋ inbox, 👍/👎)만 남는다', () => {
    const lines = describeEnabledPassiveCapabilities(reader({}));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(':raised_hand:');
    expect(lines[1]).toContain('👍/👎');
  });

  it('필요한 env 가 모두 있어야 켜진다 — 공백만 있는 값은 빈 값으로 본다', () => {
    const feedOnly = describeEnabledPassiveCapabilities(
      reader({ ART_JOB_FEED_TARGET: 'C1', ART_JOB_FEED_MENTION_USER_ID: ' ' }),
    ).join('\n');
    expect(feedOnly).toContain('원화 채용공고');
    expect(feedOnly).not.toContain('관심 없음');

    const both = describeEnabledPassiveCapabilities(
      reader({ ART_JOB_FEED_TARGET: 'C1', ART_JOB_FEED_MENTION_USER_ID: 'U1' }),
    ).join('\n');
    expect(both).toContain('「관심 없음」 버튼');
  });

  it('바꿔 둔 트리거 이모지 이름을 그대로 안내한다', () => {
    const lines = describeEnabledPassiveCapabilities(
      reader({
        SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID: 'p',
        SLACK_PUSHPIN_REACTION_EMOJI: 'memo',
        SLACK_INBOX_EMOJI: 'eyes',
      }),
    ).join('\n');
    expect(lines).toContain(':memo: 이모지를 달면 그 메시지를 Notion');
    expect(lines).toContain(':eyes: 이모지를 달면 할 일 후보');
  });
});
