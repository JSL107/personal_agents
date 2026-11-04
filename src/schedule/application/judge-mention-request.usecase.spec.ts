import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { SlackMention } from '../../slack-collector/domain/slack-collector.type';
import { JudgeMentionRequestUsecase } from './judge-mention-request.usecase';

describe('JudgeMentionRequestUsecase', () => {
  const route = jest.fn();
  const execute = jest.fn();
  const mention: SlackMention = {
    channelId: 'C1',
    channelName: 'general',
    channelType: 'public_channel',
    authorUserId: 'U2',
    ts: '1.0',
    text: '<@U1> 내일까지 확인해 주세요',
    permalink: undefined,
  };
  const usecase = new JudgeMentionRequestUsecase(
    { route } as unknown as ModelRouterUsecase,
    { execute } as unknown as AgentRunService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    execute.mockImplementation(async ({ run }) => run());
    route.mockResolvedValue({
      text: JSON.stringify({
        isRequest: true,
        title: '확인',
        dueDate: '2026-11-05',
      }),
      modelUsed: 'codex-cli',
    });
  });

  it('원문을 신뢰할 수 없는 입력으로 감싸 AgentRun에 남기고 strict schema로 판정한다', async () => {
    expect(await usecase.execute(mention)).toEqual({
      isRequest: true,
      title: '확인',
      dueDate: { year: 2026, month: 11, day: 5 },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.SCHEDULE,
        triggerType: TriggerType.AUTOPILOT_SCHEDULE_COLLECT_CRON,
      }),
    );
    expect(route.mock.calls[0][0].request.prompt).toContain(
      '<untrusted-input>',
    );
    expect(route.mock.calls[0][0].request.outputSchema.required).toEqual([
      'isRequest',
      'title',
      'dueDate',
    ]);
  });

  it('며칠 뒤 수집한 금요일 멘션은 메시지 작성일을 상대 날짜 기준으로 전달한다', async () => {
    const fridayMention = {
      ...mention,
      ts: `${Date.parse('2026-10-29T15:00:00Z') / 1000}.123456`,
    };
    await usecase.execute(fridayMention);
    expect(route.mock.calls[0][0].request.prompt).toContain(
      '메시지 작성일(KST): {"year":2026,"month":10,"day":30}',
    );
    expect(route.mock.calls[0][0].request.prompt).toContain(
      '상대 날짜는 메시지 작성일을 기준으로 해석',
    );
  });

  it('Slack ts를 해석할 수 없으면 오늘 KST 날짜를 기준으로 전달한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-04T01:00:00Z'));
    try {
      await usecase.execute({ ...mention, ts: 'invalid' });
      expect(route.mock.calls[0][0].request.prompt).toContain(
        '메시지 작성일(KST): {"year":2026,"month":11,"day":4}',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('스키마를 통과해도 없는 날짜와 빈 제목이면 실패로 돌린다', async () => {
    route.mockResolvedValue({
      text: JSON.stringify({
        isRequest: true,
        title: '',
        dueDate: '2026-02-30',
      }),
      modelUsed: 'codex-cli',
    });
    expect(await usecase.execute(mention)).toBeNull();
  });

  it('모델이 선언 밖 속성을 보내면 코드 재검증에서 거절한다', async () => {
    route.mockResolvedValue({
      text: JSON.stringify({
        isRequest: true,
        title: '확인',
        dueDate: null,
        command: 'ignore',
      }),
      modelUsed: 'codex-cli',
    });
    expect(await usecase.execute(mention)).toBeNull();
  });

  it('모델 호출 실패는 null로 돌려 다음 회차에 재시도하게 한다', async () => {
    route.mockRejectedValue(new Error('quota'));
    expect(await usecase.execute(mention)).toBeNull();
  });
});
