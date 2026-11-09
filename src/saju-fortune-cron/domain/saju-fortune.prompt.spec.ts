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
  });

  it('오늘의 비유 소재와 카드 두 줄 형식을 싣는다', () => {
    expect(prompt).toContain(
      `- 오늘의 비유 소재: ${metaphorThemeOf('2026-11-02')}`,
    );
    expect(prompt).toContain('CARD_TITLE:');
    expect(prompt).toContain('CARD_SCENE:');
  });

  it('올해·이번 달 흐름을 그날 날짜로 계산해 싣는다', () => {
    // 2026-11-02 는 입동(11-07) 전이라 아직 무술월이다.
    expect(prompt).toContain('- 올해(병오년)의 흐름:');
    expect(prompt).toContain('- 이번 달(무술월)의 흐름:');
  });

  it('타고난 기운 소개로 시작하지 말라고 못박는다', () => {
    expect(prompt).toContain('기운을 타고났어")로 시작하지 않는다');
  });

  it('다섯 항목과 행운 포인트를 요구한다', () => {
    for (const label of [
      '"총운:"',
      '"일·공부:"',
      '"사람 관계:"',
      '"돈:"',
      '"컨디션:"',
      '"행운 포인트:"',
    ]) {
      expect(prompt).toContain(label);
    }
  });
});
