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
});
