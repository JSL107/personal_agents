import {
  buildFortuneFollowUpPrompt,
  formatFortuneHeader,
  fortuneDateOf,
} from './saju-fortune-chat';

const RECIPIENT = {
  slackUserId: 'U1',
  name: '길동',
  natalPillars: ['丙寅', '辛卯', '壬戌', '庚子'],
};

describe('fortuneDateOf', () => {
  it('발송 머리말에서 날짜를 다시 읽는다 — 발송과 판별이 같은 형식을 쓴다', () => {
    const message = `${formatFortuneHeader('2026-11-02', '庚辰')}\n\n본문`;

    expect(fortuneDateOf(message)).toBe('2026-11-02');
  });

  it('Slack 이 굵게 표식을 바꿔 돌려줘도 읽는다', () => {
    expect(fortuneDateOf('🔮 오늘의 운세 — 2026-11-02 (경진일)\n본문')).toBe(
      '2026-11-02',
    );
  });

  it('첫 줄이 운세 머리말이 아니면 undefined', () => {
    expect(fortuneDateOf('안녕\n오늘의 운세 — 2026-11-02 (경진일)')).toBe(
      undefined,
    );
  });
});

describe('buildFortuneFollowUpPrompt', () => {
  const base = {
    recipient: RECIPIENT,
    fortuneDate: '2026-11-02',
    fortunePillar: '庚辰',
    originalFortune: '🔮 오늘의 운세\n총운: 좋아',
    question: '저녁엔 뭐 하면 좋아?',
  };

  it('그날 사실·아침 운세·질문을 싣는다', () => {
    const prompt = buildFortuneFollowUpPrompt({ ...base, priorTurns: [] });

    expect(prompt).toContain('그날 일진: 경진일');
    expect(prompt).toContain('- 행운의 색:');
    expect(prompt).toContain('총운: 좋아');
    expect(prompt).toContain('길동의 질문: 저녁엔 뭐 하면 좋아?');
    expect(prompt).not.toContain('앞선 대화');
  });

  it('앞선 대화는 최근 10턴만 싣는다', () => {
    const priorTurns = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `턴${index}`,
    }));

    const prompt = buildFortuneFollowUpPrompt({ ...base, priorTurns });

    expect(prompt).not.toContain('턴1\n');
    expect(prompt).toContain('길동: 턴2');
    expect(prompt).toContain('너: 턴11');
  });
});
