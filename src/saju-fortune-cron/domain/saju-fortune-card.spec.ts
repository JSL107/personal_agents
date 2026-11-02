import {
  buildFortuneCardImagePrompt,
  parseFortuneResponse,
} from './saju-fortune-card';

describe('parseFortuneResponse', () => {
  it('카드 두 줄을 떼어 내고 본문만 남긴다', () => {
    const parsed = parseFortuneResponse(
      '오늘은 맑음\n총운: 좋아\n\nCARD_TITLE: THE STEADY RIVER\nCARD_SCENE: A calm river under a crescent moon.',
    );

    expect(parsed.body).toBe('오늘은 맑음\n총운: 좋아');
    expect(parsed.card).toEqual({
      title: 'THE STEADY RIVER',
      scene: 'A calm river under a crescent moon.',
    });
  });

  it('줄 앞에 장식이 붙어도 값을 읽는다', () => {
    const parsed = parseFortuneResponse(
      '본문\n- CARD_TITLE: THE SUN\n- CARD_SCENE: A sun.',
    );

    expect(parsed.card?.title).toBe('THE SUN');
  });

  it.each([
    ['한글 제목', '본문\nCARD_TITLE: 고요한 강\nCARD_SCENE: A river.'],
    ['장면 없음', '본문\nCARD_TITLE: THE SUN'],
    ['제목 없음', '본문\nCARD_SCENE: A river.'],
  ])('%s 이면 카드 없이 본문만 돌려주고 카드 줄은 본문에서 뺀다', (_, text) => {
    const parsed = parseFortuneResponse(text);

    expect(parsed.card).toBeUndefined();
    expect(parsed.body).toBe('본문');
  });

  it('카드 줄이 아예 없으면 응답 전체가 본문이다', () => {
    expect(parseFortuneResponse('  그냥 운세  ')).toEqual({
      body: '그냥 운세',
    });
  });
});

describe('buildFortuneCardImagePrompt', () => {
  it('제목과 장면을 싣고 셸 명령을 금지한다', () => {
    const prompt = buildFortuneCardImagePrompt({
      title: 'THE SUN',
      scene: 'A sun over a field.',
    });

    expect(prompt).toContain('"THE SUN"');
    expect(prompt).toContain('Scene: A sun over a field.');
    expect(prompt).toContain('Do not run any shell commands');
  });
});
