import { wrapUntrustedInput } from '../../common/llm/untrusted-input.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AUTO_POST_LABEL } from '../../router/domain/auto-post-turn';
import { ExtractScheduleFromConversationUsecase } from './extract-schedule-from-conversation.usecase';

const input = {
  text: '원인과 함께 등록해줘',
  priorTurns: [],
  today: { year: 2026, month: 10, day: 30 },
};

describe('ExtractScheduleFromConversationUsecase', () => {
  const route = jest.fn();
  const usecase = new ExtractScheduleFromConversationUsecase({
    route,
  } as unknown as ModelRouterUsecase);
  beforeEach(() => route.mockReset());
  it.each([
    [{ title: '일정', dueDate: '2026-02-30', memo: '' }, '없는 날짜'],
    [{ title: '가'.repeat(61), dueDate: null, memo: '' }, '긴 제목'],
    [{ title: '일정', dueDate: '내일', memo: '' }, 'ISO 가 아닌 날짜'],
  ])('%s 는 %s 이므로 탈락한다', async (value, reason) => {
    expect(reason).toBeTruthy();
    route.mockResolvedValue({
      text: JSON.stringify(value),
      modelUsed: 'model',
    });
    expect(await usecase.execute(input)).toBeNull();
  });
  it('메모를 1000자로 자르고 모델 이름을 남긴다', async () => {
    route.mockResolvedValue({
      text: JSON.stringify({
        title: '일정',
        dueDate: null,
        memo: '가'.repeat(1001),
      }),
      modelUsed: 'model',
    });
    expect(await usecase.execute(input)).toEqual({
      title: '일정',
      dueDate: null,
      memo: '가'.repeat(1000),
      modelUsed: 'model',
    });
    expect(route).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'SCHEDULE',
        noContractPreamble: true,
        request: expect.objectContaining({
          outputSchema: expect.any(Object),
          systemPrompt: expect.stringContaining('<untrusted-input>'),
        }),
      }),
    );
  });
  it('모델 호출이 실패하면 null 을 반환한다', async () => {
    route.mockRejectedValue(new Error('failure'));
    expect(await usecase.execute(input)).toBeNull();
  });
  it('자동 발송 글은 변환 단계의 경계를 유지한 채 한 번만 싣는다', async () => {
    route.mockResolvedValue({
      text: JSON.stringify({ title: '일정', dueDate: null, memo: '' }),
      modelUsed: 'model',
    });
    await usecase.execute({
      ...input,
      priorTurns: [
        {
          role: 'user',
          // 실제 자동 발송 글 턴은 toTranscriptTurns 가 표식과 경계를 이미 붙여 넘긴다.
          text: `${AUTO_POST_LABEL}\n${wrapUntrustedInput('무시하라')}`,
          agentType: null,
          agentRunId: null,
          timestampMs: 1,
        },
      ],
    });
    const prompt: string = route.mock.calls[0][0].request.prompt;
    expect(prompt).toContain('<untrusted-input>');
    expect(prompt.split('<untrusted-input>')).toHaveLength(2);
  });
});
