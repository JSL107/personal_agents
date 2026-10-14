import { holidayCalendarOf } from '../../holiday/domain/business-calendar';
import { IdeaTriageRecord } from '../domain/port/idea-triage.repository.port';
import { TriageIdeaChannelUsecase } from './triage-idea-channel.usecase';

const record = (
  overrides: Partial<IdeaTriageRecord> = {},
): IdeaTriageRecord => ({
  id: 1,
  channelId: 'C123',
  messageTs: '100.000001',
  authorSlackUserId: 'U123',
  ideaText: '개발 아이디어',
  verdict: 'DROP',
  reason: '사용자가 불명확합니다.',
  counterpoint: '수요가 있을 수 있습니다.',
  scheduleTitle: '아이디어 개발',
  effort: 'S',
  proposedDate: { year: 2026, month: 10, day: 15 },
  agentRunId: 1,
  status: 'JUDGED',
  replyTs: null,
  previewId: null,
  scheduleItemId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const setup = (channelId: string | undefined = 'C123') => {
  const configService = { get: jest.fn().mockReturnValue(channelId) };
  const channelReader = {
    listRecent: jest.fn().mockResolvedValue([]),
    getPermalink: jest
      .fn()
      .mockResolvedValue('https://slack.com/archives/C123/p100'),
  };
  const triageRepository = {
    findUnposted: jest.fn().mockResolvedValue([]),
    findExisting: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(async (input) => record(input)),
    markReplySent: jest.fn().mockResolvedValue(undefined),
    markPreviewCreated: jest.fn().mockResolvedValue(undefined),
    markPosted: jest.fn().mockResolvedValue(undefined),
  };
  const holidayCalendar = {
    load: jest.fn().mockResolvedValue(holidayCalendarOf([])),
  };
  const judgeIdea = {
    execute: jest.fn().mockResolvedValue({
      judgement: {
        verdict: 'DROP',
        reason: '사용자가 불명확합니다.',
        counterpoint: '수요가 있을 수 있습니다.',
        scheduleTitle: '아이디어 개발',
        effort: 'S',
      },
      agentRunId: 1,
    }),
  };
  const createPreview = {
    execute: jest.fn().mockResolvedValue({
      id: 'preview-1',
      kind: 'IDEA_SCHEDULE',
      previewText: '카드',
      payload: {},
    }),
  };
  const previewRepository = {
    attachSlackMessage: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue(null),
  };
  const slackNotifier = {
    postMessage: jest.fn().mockResolvedValue({ ts: 'reply-1' }),
    postPreviewMessage: jest
      .fn()
      .mockResolvedValue({ channelId: 'C123', messageTs: 'card-1' }),
  };
  const usecase = new TriageIdeaChannelUsecase(
    configService as never,
    channelReader,
    triageRepository as never,
    holidayCalendar,
    judgeIdea as never,
    createPreview as never,
    previewRepository as never,
    slackNotifier as never,
  );
  return {
    usecase,
    channelReader,
    triageRepository,
    holidayCalendar,
    judgeIdea,
    createPreview,
    previewRepository,
    slackNotifier,
  };
};

const input = { ownerSlackUserId: 'UOWNER', firedAtKst: '2026-10-14' };

describe('TriageIdeaChannelUsecase', () => {
  it('채널 미설정이면 외부 포트를 호출하지 않는다', async () => {
    const fixtures = setup('');

    const result = await fixtures.usecase.execute(input);

    expect(result.skipped).toBe('NOT_CONFIGURED');
    expect(fixtures.channelReader.listRecent).not.toHaveBeenCalled();
    expect(fixtures.triageRepository.findUnposted).not.toHaveBeenCalled();
  });

  it('스레드 답글·봇·subtype·빈 글·기존 글을 제외하고 오래된 신규 글만 판정한다', async () => {
    const fixtures = setup();
    fixtures.channelReader.listRecent.mockResolvedValue([
      { ts: '9', text: '신규' },
      { ts: '2', text: '기존' },
      { ts: '3', text: '답글', threadTs: '1' },
      { ts: '4', text: '봇', botId: 'B1' },
      { ts: '5', text: '수정', subtype: 'message_changed' },
      { ts: '6', text: '  ' },
      { ts: '7', text: '먼저' },
    ]);
    fixtures.triageRepository.findExisting.mockResolvedValue(['2']);

    const result = await fixtures.usecase.execute(input);

    expect(
      fixtures.judgeIdea.execute.mock.calls.map(([value]) => value.messageTs),
    ).toEqual(['7', '9']);
    expect(result).toMatchObject({
      judged: 2,
      posted: 2,
      failed: 0,
      byVerdict: { DROP: 2 },
    });
    expect(fixtures.createPreview.execute).not.toHaveBeenCalled();
  });

  it('회차당 신규 판정을 10건으로 제한한다', async () => {
    const fixtures = setup();
    fixtures.channelReader.listRecent.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        ts: String(index + 1),
        text: '아이디어',
      })),
    );

    const result = await fixtures.usecase.execute(input);

    expect(result.judged).toBe(10);
    expect(fixtures.judgeIdea.execute).toHaveBeenCalledTimes(10);
  });

  it('JUDGED 행은 모델 재호출 없이 게시한다', async () => {
    const fixtures = setup();
    fixtures.triageRepository.findUnposted.mockResolvedValue([record()]);

    const result = await fixtures.usecase.execute(input);

    expect(result.posted).toBe(1);
    expect(fixtures.judgeIdea.execute).not.toHaveBeenCalled();
    expect(fixtures.triageRepository.markPosted).toHaveBeenCalledWith(
      1,
      'reply-1',
    );
  });

  it('히스토리 읽기가 불가능해도 앞서 재게시한 결과를 보존한다', async () => {
    const fixtures = setup();
    fixtures.triageRepository.findUnposted.mockResolvedValue([record()]);
    fixtures.channelReader.listRecent.mockResolvedValue(null);

    const result = await fixtures.usecase.execute(input);

    expect(result).toMatchObject({ posted: 1, failed: 0 });
    expect(result.skipped).toBeUndefined();
    expect(fixtures.judgeIdea.execute).not.toHaveBeenCalled();
  });

  it('한 글 실패 후 다음 글을 계속 처리한다', async () => {
    const fixtures = setup();
    fixtures.channelReader.listRecent.mockResolvedValue([
      { ts: '1', text: '실패' },
      { ts: '2', text: '성공' },
    ]);
    fixtures.judgeIdea.execute.mockRejectedValueOnce(new Error('model failed'));

    const result = await fixtures.usecase.execute(input);

    expect(result).toMatchObject({ judged: 1, posted: 1, failed: 1 });
    expect(fixtures.judgeIdea.execute).toHaveBeenCalledTimes(2);
  });

  it('BUILD 는 답글과 승인 카드를 원글 스레드에 게시한다', async () => {
    const fixtures = setup();
    fixtures.channelReader.listRecent.mockResolvedValue([
      { ts: '1', text: '아이디어' },
    ]);
    fixtures.judgeIdea.execute.mockResolvedValue({
      judgement: {
        verdict: 'BUILD',
        reason: '좋습니다.',
        counterpoint: '비용이 듭니다.',
        scheduleTitle: '기능 개발',
        effort: 'M',
      },
      agentRunId: 1,
    });

    const result = await fixtures.usecase.execute(input);

    expect(result.byVerdict.BUILD).toBe(1);
    expect(fixtures.slackNotifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadTs: '1',
        text: expect.stringContaining('3영업일'),
      }),
    );
    expect(fixtures.slackNotifier.postPreviewMessage).toHaveBeenCalledWith(
      expect.objectContaining({ threadTs: '1' }),
    );
    expect(fixtures.previewRepository.attachSlackMessage).toHaveBeenCalled();
  });

  it('카드 발송 실패 뒤 JUDGED 재시도는 저장한 답글과 카드를 재사용한다', async () => {
    const fixtures = setup();
    const saved = record({ verdict: 'BUILD' });
    fixtures.triageRepository.findUnposted.mockResolvedValue([saved]);
    fixtures.triageRepository.markReplySent.mockImplementation(
      async (_id, replyTs) => {
        saved.replyTs = replyTs;
      },
    );
    fixtures.triageRepository.markPreviewCreated.mockImplementation(
      async (_id, previewId) => {
        saved.previewId = previewId;
      },
    );
    fixtures.slackNotifier.postPreviewMessage.mockRejectedValueOnce(
      new Error('Slack failed'),
    );

    await fixtures.usecase.execute(input);
    await fixtures.usecase.execute(input);

    expect(fixtures.slackNotifier.postMessage).toHaveBeenCalledTimes(1);
    expect(fixtures.createPreview.execute).toHaveBeenCalledTimes(1);
    expect(fixtures.slackNotifier.postPreviewMessage).toHaveBeenCalledTimes(2);
    expect(fixtures.triageRepository.markPosted).toHaveBeenCalledWith(
      1,
      'reply-1',
      'preview-1',
    );
  });
});
