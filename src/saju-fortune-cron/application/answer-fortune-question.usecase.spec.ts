import { ConfigService } from '@nestjs/config';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { AnswerFortuneQuestionUsecase } from './answer-fortune-question.usecase';

const RECIPIENTS = 'U111|길동|丙寅 辛卯 壬戌 庚子';
const FORTUNE = '🔮 *오늘의 운세 — 2026-11-02 (경진일)*\n\n총운: 좋아';

describe('AnswerFortuneQuestionUsecase', () => {
  let route: jest.Mock;
  let usecase: AnswerFortuneQuestionUsecase;

  beforeEach(() => {
    route = jest.fn().mockResolvedValue({ text: ' 산책해 봐 ' });
    usecase = new AnswerFortuneQuestionUsecase(
      { get: () => RECIPIENTS } as unknown as ConfigService,
      { route } as unknown as ModelRouterUsecase,
    );
  });

  const ask = (overrides: { slackUserId?: string; text?: string } = {}) =>
    usecase.answer({
      slackUserId: overrides.slackUserId ?? 'U111',
      fortuneMessageText: overrides.text ?? FORTUNE,
      priorTurns: [],
      question: '저녁엔?',
    });

  it('그날 일진으로 프롬프트를 만들어 PM 을 머리말 없이 부른다', async () => {
    await expect(ask()).resolves.toBe('산책해 봐');

    expect(route.mock.calls[0][0]).toMatchObject({
      agentType: AgentType.PM,
      noContractPreamble: true,
    });
    expect(route.mock.calls[0][0].request.prompt).toContain('경진일');
  });

  it('운세 DM 이 아니면 모델을 부르지 않고 null', async () => {
    await expect(ask({ text: '그냥 메시지' })).resolves.toBeNull();
    expect(route).not.toHaveBeenCalled();
  });

  it('받는 사람 목록에 없으면 null', async () => {
    await expect(ask({ slackUserId: 'U999' })).resolves.toBeNull();
    expect(route).not.toHaveBeenCalled();
  });

  it('한자가 섞이면 한 번 다시 만든다', async () => {
    route
      .mockResolvedValueOnce({ text: '庚金의 날' })
      .mockResolvedValueOnce({ text: '쇠 기운의 날' });

    await expect(ask()).resolves.toBe('쇠 기운의 날');
    expect(route).toHaveBeenCalledTimes(2);
  });

  it('명리 용어가 섞여도 한 번 다시 만든다', async () => {
    route
      .mockResolvedValueOnce({ text: '편재가 들어온 날' })
      .mockResolvedValueOnce({ text: '돈이 들어오는 날' });

    await expect(ask()).resolves.toBe('돈이 들어오는 날');
    expect(route).toHaveBeenCalledTimes(2);
  });

  it('아침 메시지의 별점을 인용하는 답은 다시 만들지 않는다', async () => {
    route.mockResolvedValueOnce({ text: '총운 ★★★★☆ 였지' });

    await expect(ask()).resolves.toBe('총운 ★★★★☆ 였지');
    expect(route).toHaveBeenCalledTimes(1);
  });
});

describe('AnswerFortuneQuestionUsecase — 주간·특집 메시지 답글', () => {
  // 2026-11-16 은 월요일(갑오일). 길동은 그날 생일.
  const BIRTHDAY_RECIPIENTS = 'U111|길동|丙寅 辛卯 壬戌 庚子||11-16';

  const promptFor = async (text: string): Promise<string> => {
    const route = jest.fn().mockResolvedValue({ text: '산책해 봐' });
    const usecase = new AnswerFortuneQuestionUsecase(
      { get: () => BIRTHDAY_RECIPIENTS } as unknown as ConfigService,
      { route } as unknown as ModelRouterUsecase,
    );
    await usecase.answer({
      slackUserId: 'U111',
      fortuneMessageText: text,
      priorTurns: [],
      question: '생일인데 뭐 하지?',
    });
    return route.mock.calls[0][0].request.prompt;
  };

  it('월요일 합본(이번 주 운세)에도 생일 사실과 주간 사실을 함께 싣는다', async () => {
    const prompt = await promptFor(
      '🔮 *이번 주 운세 — 2026-11-16 (갑오일)*\n\n🎂 생일 축하해, 길동!',
    );

    expect(prompt).toContain('오늘은 길동의 생일이다');
    expect(prompt).toMatch(/- 총운: /);
  });

  it('특별한 날 메시지에는 주간 사실을 싣지 않는다', async () => {
    const prompt = await promptFor(
      '🔮 *특별한 날 — 2026-11-16 (갑오일)*\n\n🎂 생일 축하해, 길동!',
    );

    expect(prompt).toContain('오늘은 길동의 생일이다');
    expect(prompt).not.toContain('이번 주(월~일)');
  });

  it('그날 일일 운세에 단 답에도 특별한 날 사실은 싣는다', async () => {
    const prompt = await promptFor(
      '🔮 *오늘의 운세 — 2026-11-16 (갑오일)*\n\n총운: 좋아',
    );

    expect(prompt).toContain('오늘은 길동의 생일이다');
    expect(prompt).not.toContain('이번 주(월~일)');
  });
});
