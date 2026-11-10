import {
  buildFortuneFollowUpPrompt,
  formatExtraFortuneHeader,
  formatFortuneHeader,
  fortuneDateOf,
  FortuneMessageKind,
  fortuneMessageOf,
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

  it('Slack 이 이모지를 단축 코드로 바꿔 돌려줘도 읽는다', () => {
    expect(
      fortuneDateOf(':crystal_ball: *오늘의 운세 — 2026-11-02 (경진일)*\n본문'),
    ).toBe('2026-11-02');
  });

  it('첫 줄 중간에 머리말을 인용한 글은 운세로 보지 않는다', () => {
    expect(
      fortuneDateOf(
        '아침에 보낸 🔮 *오늘의 운세 — 2026-11-02 (경진일)* 말이지?',
      ),
    ).toBeUndefined();
  });

  it('첫 줄이 운세 머리말이 아니면 undefined', () => {
    expect(fortuneDateOf('안녕\n오늘의 운세 — 2026-11-02 (경진일)')).toBe(
      undefined,
    );
  });
});

describe('fortuneMessageOf', () => {
  it.each([
    [formatFortuneHeader('2026-11-16', '甲午'), 'daily'],
    [
      formatExtraFortuneHeader({
        kind: FortuneMessageKind.WEEKLY,
        todayKst: '2026-11-16',
        todayPillar: '甲午',
      }),
      'weekly',
    ],
    [
      formatExtraFortuneHeader({
        kind: FortuneMessageKind.SPECIAL,
        todayKst: '2026-11-16',
        todayPillar: '甲午',
      }),
      'special',
    ],
  ])('발송 머리말 %s → %s', (header, kind) => {
    expect(fortuneMessageOf(`${header}\n\n본문`)).toEqual({
      date: '2026-11-16',
      kind,
    });
  });

  it('머리말 모양은 일일과 같다 — 🔮 · 제목 · 날짜 · 일진', () => {
    expect(
      formatExtraFortuneHeader({
        kind: FortuneMessageKind.WEEKLY,
        todayKst: '2026-11-16',
        todayPillar: '甲午',
      }),
    ).toBe('🔮 *이번 주 운세 — 2026-11-16 (갑오일)*');
  });

  it('단축 코드·굵게 표식 없는 변형도 읽는다', () => {
    expect(
      fortuneMessageOf(':crystal_ball: 특별한 날 — 2027-02-04 (경진일)\n본문'),
    ).toEqual({ date: '2027-02-04', kind: 'special' });
  });

  it('둘째 줄의 머리말·달력에 없는 날짜는 운세로 보지 않는다', () => {
    expect(
      fortuneMessageOf('안녕\n🔮 *이번 주 운세 — 2026-11-16 (갑오일)*'),
    ).toBeUndefined();
    expect(
      fortuneMessageOf('🔮 *특별한 날 — 2026-02-30 (갑자일)*'),
    ).toBeUndefined();
  });

  it('fortuneDateOf 는 세 머리말 모두에서 날짜를 준다', () => {
    expect(fortuneDateOf('🔮 *이번 주 운세 — 2026-11-16 (갑오일)*')).toBe(
      '2026-11-16',
    );
  });
});

describe('buildFortuneFollowUpPrompt', () => {
  const base = {
    recipient: RECIPIENT,
    fortuneDate: '2026-11-02',
    fortunePillar: '庚辰',
    yearMonthPillars: { yearPillar: '丙午', monthPillar: '戊戌' },
    originalFortune: '🔮 오늘의 운세\n총운: 좋아',
    question: '저녁엔 뭐 하면 좋아?',
  };

  it('특별한 날·이번 주 사실을 계산된 사실 블록에 함께 싣고 원문이 우선이라고 한다', () => {
    const prompt = buildFortuneFollowUpPrompt({
      ...base,
      priorTurns: [],
      specialFacts: ['- 오늘은 길동의 생일이다.'],
      weeklyFacts: ['- 총운: 좋은 날 화요일'],
    });
    const factsBlock = prompt.slice(
      prompt.indexOf('계산된 사실'),
      prompt.indexOf('아침에 보낸 운세:'),
    );

    expect(factsBlock).toContain('- 오늘은 길동의 생일이다.');
    expect(factsBlock).toContain('- 총운: 좋은 날 화요일');
    expect(prompt).toContain('원문이 우선');
  });

  it('그날 사실·아침 운세·질문을 싣는다', () => {
    const prompt = buildFortuneFollowUpPrompt({ ...base, priorTurns: [] });

    expect(prompt).toContain('그날 일진: 경진일');
    expect(prompt).toContain('- 타고난 오행 분포:');
    expect(prompt).toContain('- 오늘의 행운 기운:');
    expect(prompt).toContain(
      '아침 메시지에 없는 별점이나 숫자를 새로 지어내지 않는다',
    );
    expect(prompt).toContain('- 이번 달(무술월)의 흐름:');
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
