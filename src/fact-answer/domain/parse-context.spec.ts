import { buildParsePromptWithContext } from './parse-context';

const turn = (role: 'user' | 'assistant', text: string) => ({
  role,
  text,
  agentType: null,
  agentRunId: null,
  timestampMs: 0,
});

describe('buildParsePromptWithContext', () => {
  it('직전 대화가 없으면 오늘 날짜와 이번 메시지만 싣는다', () => {
    expect(
      buildParsePromptWithContext('2026-10-07', { text: '휴가 며칠 남았어?' }),
    ).toBe('[오늘: 2026-10-07]\n[이번 메시지]\n휴가 며칠 남았어?');
  });

  it('최근 3턴만, 오래된 순서와 역할을 지켜 싣는다', () => {
    const prompt = buildParsePromptWithContext('2026-10-07', {
      text: '8일 기준이라면 4일이 남은게 맞아?',
      priorTurns: [
        turn('user', '첫 턴'),
        turn('assistant', '둘째 턴'),
        turn('user', '셋째 턴'),
        turn('assistant', '넷째 턴'),
      ],
    });
    expect(prompt).toBe(
      [
        '[오늘: 2026-10-07]',
        '[이전 대화]',
        '[assistant] 둘째 턴',
        '[user] 셋째 턴',
        '[assistant] 넷째 턴',
        '[이번 메시지]',
        '8일 기준이라면 4일이 남은게 맞아?',
      ].join('\n'),
    );
  });

  it('턴 본문은 200자에서 자른다', () => {
    const prompt = buildParsePromptWithContext('2026-10-07', {
      text: '질문',
      priorTurns: [turn('user', '가'.repeat(250))],
    });
    expect(prompt).toContain(`[user] ${'가'.repeat(200)}\n`);
    expect(prompt).not.toContain('가'.repeat(201));
  });
});
