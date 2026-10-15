import { Queue, QueueEvents } from 'bullmq';

import { AgentType } from '../../model-router/domain/model-router.type';
import { DispatchInput } from '../../router/domain/idaeri-router.port';
import { ArtJobFeedDispatcher } from './art-job-feed.dispatcher';

const keywordSet = {
  target: ['원화'],
  excluded: ['3D'],
  style: ['북미풍'],
};

const setup = () => {
  const keywords = {
    load: jest.fn().mockResolvedValue(keywordSet),
    add: jest.fn().mockResolvedValue({ added: ['캐주얼'], existing: [] }),
    remove: jest.fn().mockResolvedValue({ removed: ['캐주얼'], missing: [] }),
  };
  const waitUntilFinished = jest.fn().mockResolvedValue({ kind: 'NO_NEW' });
  const queue = {
    name: 'art-job-feed-cron',
    opts: { connection: {} },
    add: jest.fn().mockResolvedValue({ waitUntilFinished }),
  };
  const configService = {
    get: jest.fn((key: string) =>
      key === 'ART_JOB_FEED_TARGET' ? 'C_ART' : undefined,
    ),
  };
  const agentRunService = {
    execute: jest.fn(
      async (input: {
        run: () => Promise<{ result: unknown; modelUsed: string }>;
      }) => {
        const outcome = await input.run();
        return { agentRunId: 12, ...outcome };
      },
    ),
  };
  const dispatcher = new ArtJobFeedDispatcher(
    keywords,
    queue as unknown as Queue,
    configService as never,
    agentRunService as never,
  );
  (dispatcher as unknown as { queueEvents: QueueEvents }).queueEvents = {
    close: jest.fn(),
  } as unknown as QueueEvents;
  const input = (text: string, channel = 'C_ART'): DispatchInput => ({
    source: 'SLACK_MESSAGE',
    slackUserId: 'U1',
    text,
    replyContext: { channel },
  });
  return {
    dispatcher,
    input,
    keywords,
    queue,
    waitUntilFinished,
    agentRunService,
  };
};

describe('ArtJobFeedDispatcher', () => {
  it('다른 채널에서 쓰기를 거절하고 원장을 만들지 않는다', async () => {
    const { dispatcher, input, keywords, agentRunService } = setup();
    const outcome = await dispatcher.dispatch(
      input('화풍에 "캐주얼" 추가해줘', 'C_OTHER'),
    );
    expect(outcome.formattedText).toContain('<#C_ART>');
    expect(keywords.add).not.toHaveBeenCalled();
    expect(agentRunService.execute).not.toHaveBeenCalled();
  });

  it('모호한 목록을 되묻고 후속 화풍 답변으로 키워드를 추가한다', async () => {
    const { dispatcher, input, keywords } = setup();
    const first = await dispatcher.dispatch(
      input('[캐주얼 / 북미풍] 키워드도 찾아줬으면 좋겠어!'),
    );
    expect(first.formattedText).toContain('중 한 곳을 골라 주세요');
    const followUp = input('화풍');
    followUp.priorTurns = [
      {
        role: 'user',
        text: '[캐주얼 / 북미풍] 키워드도 찾아줬으면 좋겠어!',
        agentType: AgentType.ART_JOB_FEED,
        agentRunId: null,
        timestampMs: 1,
      },
    ];
    await dispatcher.dispatch(followUp);
    expect(keywords.add).toHaveBeenCalledWith(
      'STYLE',
      ['캐주얼', '북미풍'],
      'U1',
    );
  });

  it('질문형 요청은 쓰지 않고 현재 키워드로 답한다', async () => {
    const { dispatcher, input, keywords } = setup();
    const outcome = await dispatcher.dispatch(input('공고 가져와?'));
    expect(outcome.formattedText).toContain('질문으로 보여서');
    expect(outcome.formattedText).toContain('허용');
    expect(keywords.load).toHaveBeenCalled();
  });

  it('직전 질문형 요청과 목록 후속 답을 합쳐도 쓰지 않는다', async () => {
    const { dispatcher, input, keywords } = setup();
    const followUp = input('화풍');
    followUp.priorTurns = [
      {
        role: 'user',
        text: '"캐주얼" 키워드 추가해도 돼?',
        agentType: AgentType.ART_JOB_FEED,
        agentRunId: null,
        timestampMs: 1,
      },
    ];
    const outcome = await dispatcher.dispatch(followUp);
    expect(outcome.formattedText).toContain('질문으로 보여서');
    expect(keywords.add).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'POSTED', count: 2 }, '새 공고 2건'],
    [{ kind: 'NO_NEW' }, '새 원화 공고가 없어요'],
    [{ kind: 'SLOT_TAKEN' }, '이미 처리됐어요'],
  ])('FETCH 결과 %p를 답한다', async (result, expected) => {
    const { dispatcher, input, waitUntilFinished, queue } = setup();
    waitUntilFinished.mockResolvedValue(result);
    const outcome = await dispatcher.dispatch(input('공고 가져와'));
    expect(outcome.formattedText).toContain(expected);
    expect(queue.add).toHaveBeenCalledWith(
      'art-job-feed-manual',
      expect.objectContaining({ trigger: 'MANUAL' }),
      expect.objectContaining({ attempts: 1 }),
    );
  });

  it('키워드를 함께 말한 가져오기는 그 키워드가 어떻게 쓰이는지 알린다', async () => {
    const { dispatcher, input, waitUntilFinished, keywords } = setup();
    waitUntilFinished.mockResolvedValue({ kind: 'POSTED', count: 2 });
    const outcome = await dispatcher.dispatch(
      input('[원화 / 북미풍 / 반실사] 관련 공고 찾아줘'),
    );
    expect(outcome.formattedText).toContain('새 공고 2건');
    expect(outcome.formattedText).toContain('허용 목록에 있음: 원화');
    expect(outcome.formattedText).toContain(
      '화풍 태그로만 씀(거르지 않고 🎨 태그): 북미풍',
    );
    expect(outcome.formattedText).toContain('목록에 없음: 반실사');
    expect(keywords.add).not.toHaveBeenCalled();
  });

  it('대기 시간 초과는 실행 중으로 답한다', async () => {
    const { dispatcher, input, waitUntilFinished } = setup();
    waitUntilFinished.mockRejectedValue(
      new Error(
        'Job wait art-job-feed-manual timed out before finishing, no finish notification arrived after 300000ms (id=1)',
      ),
    );
    const outcome = await dispatcher.dispatch(input('공고 가져와'));
    expect(outcome.formattedText).toContain('아직 가져오는 중이에요');
  });
});
