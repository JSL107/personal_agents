import {
  buildSajuFortunePrompt,
  METAPHOR_THEMES,
  metaphorThemeOf,
} from './saju-fortune.prompt';

const RECIPIENT = {
  slackUserId: 'U1',
  name: '길동',
  natalPillars: ['丙寅', '辛卯', '壬戌', '庚子'],
};

describe('metaphorThemeOf', () => {
  it('같은 날짜는 같은 소재, 연속한 날짜는 다른 소재다', () => {
    expect(metaphorThemeOf('2026-11-02')).toBe(metaphorThemeOf('2026-11-02'));
    expect(metaphorThemeOf('2026-11-02')).not.toBe(
      metaphorThemeOf('2026-11-03'),
    );
  });

  it('소재 수만큼의 연속한 날짜에 모든 소재가 한 번씩 나온다', () => {
    const themes = Array.from({ length: METAPHOR_THEMES.length }, (_, day) =>
      metaphorThemeOf(
        new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10),
      ),
    );

    expect(new Set(themes).size).toBe(METAPHOR_THEMES.length);
  });
});

describe('buildSajuFortunePrompt', () => {
  const prompt = buildSajuFortunePrompt({
    recipient: RECIPIENT,
    todayKst: '2026-11-02',
    todayPillar: '庚辰',
    // 2026-11-02 는 입동(11-07) 전이라 아직 무술월이다.
    yearMonthPillars: { yearPillar: '丙午', monthPillar: '戊戌' },
  });

  it('오늘의 비유 소재와 카드 두 줄 형식을 싣는다', () => {
    expect(prompt).toContain(
      `- 오늘의 비유 소재: ${metaphorThemeOf('2026-11-02')}`,
    );
    expect(prompt).toContain('CARD_TITLE:');
    expect(prompt).toContain('CARD_SCENE:');
  });

  it('넘겨받은 올해·이번 달 흐름을 싣고, 총운에서만 엮으라고 한다', () => {
    expect(prompt).toContain('- 올해(병오년)의 흐름:');
    expect(prompt).toContain('- 이번 달(무술월)의 흐름:');
    expect(prompt).toContain('"총운:" 에서만 한 번 짧게 엮는다');
  });

  it('타고난 기운 소개로 시작하지 말라고 못박는다', () => {
    expect(prompt).toContain('기운을 타고났어")로 시작하지 않는다');
  });

  it('다섯 항목과 오늘의 한 마디를 요구한다', () => {
    for (const label of [
      '"총운:"',
      '"일·공부:"',
      '"사람 관계:"',
      '"돈:"',
      '"컨디션:"',
      '"오늘의 한 마디:"',
    ]) {
      expect(prompt).toContain(label);
    }
  });

  // 오늘의 미션(코드가 고르고 그린다)이 행운 포인트 자리를 대신한다 — 두 줄이 같은 권유를 겹쳐 하지 않게.
  it('행운 포인트를 요구하지 않는다', () => {
    expect(prompt).not.toContain('행운 포인트');
    expect(prompt).not.toContain('계산된 행운의 색');
    expect(prompt).toContain('- 오늘의 행운 기운:');
  });

  it("'미션' 이라는 말과 🎯 를 쓰지 말라고 한다", () => {
    expect(prompt).toContain("'미션'이라는 말과 🎯 이모지는 쓰지 않는다");
  });

  it('조심할 날 항목엔 대처를, 별점·숫자·🍀 는 쓰지 않게 한다', () => {
    expect(prompt).toContain('"조심할 날"인 항목에는');
    expect(prompt).toContain('별점·숫자는 쓰지 않는다');
    expect(prompt).toContain('🍀 이모지는 쓰지 않는다');
    expect(prompt).toContain('- 별점 결(코드가 정함):');
  });
});
