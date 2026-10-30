import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import { PreviewAction } from '../domain/preview-action.type';
import { FindAnswerablePreviewUsecase } from './find-answerable-preview.usecase';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const CARD = { id: 'p-1' } as PreviewAction;

describe('FindAnswerablePreviewUsecase', () => {
  const findPendingAnswerCandidates = jest.fn();
  const repository = {
    findPendingAnswerCandidates,
  } as unknown as PreviewActionRepositoryPort;
  const usecase = new FindAnswerablePreviewUsecase(repository);

  beforeEach(() => {
    findPendingAnswerCandidates.mockReset().mockResolvedValue([]);
  });

  it('스레드 응답은 동일 채널과 root ts에 있는 카드만 조회한다', async () => {
    await expect(
      usecase.execute({
        slackUserId: 'U1',
        now: NOW,
        scope: { kind: 'SLACK_THREAD', channelId: 'C1', threadTs: '123.456' },
      }),
    ).resolves.toEqual({ status: 'NONE' });
    expect(findPendingAnswerCandidates).toHaveBeenCalledWith({
      slackUserId: 'U1',
      now: NOW,
      slackChannelId: 'C1',
      slackThreadTs: '123.456',
      limit: 2,
    });
  });

  it('최상위 응답은 동일 채널의 최근 30분 카드만 조회한다', async () => {
    await usecase.execute({
      slackUserId: 'U1',
      now: NOW,
      scope: { kind: 'SLACK_TOP_LEVEL', channelId: 'C1' },
    });
    expect(findPendingAnswerCandidates).toHaveBeenCalledWith({
      slackUserId: 'U1',
      now: NOW,
      slackChannelId: 'C1',
      createdSince: new Date('2026-10-30T11:30:00.000Z'),
      limit: 2,
    });
  });

  it('콘솔 응답은 채널 없이 최근 30분 카드만 조회한다', async () => {
    await usecase.execute({
      slackUserId: 'U1',
      now: NOW,
      scope: { kind: 'CONSOLE' },
    });
    expect(findPendingAnswerCandidates).toHaveBeenCalledWith({
      slackUserId: 'U1',
      now: NOW,
      createdSince: new Date('2026-10-30T11:30:00.000Z'),
      limit: 2,
    });
  });

  it('후보 한 장이면 그 카드를 반환한다', async () => {
    findPendingAnswerCandidates.mockResolvedValue([CARD]);
    const result = await usecase.execute({
      slackUserId: 'U1',
      now: NOW,
      scope: { kind: 'CONSOLE' },
    });
    expect(result).toEqual({ status: 'ONE', preview: CARD });
  });

  it('후보가 두 장이면 선택하지 않고 모호함을 반환한다', async () => {
    findPendingAnswerCandidates.mockResolvedValue([CARD, { id: 'p-2' }]);
    const result = await usecase.execute({
      slackUserId: 'U1',
      now: NOW,
      scope: { kind: 'CONSOLE' },
    });
    expect(result).toEqual({ status: 'AMBIGUOUS' });
  });
});

describe('FindAnswerablePreviewUsecase 범위별 후보 선택', () => {
  const card = ({
    id,
    channelId,
    threadTs,
    createdAt,
  }: {
    id: string;
    channelId: string | null;
    threadTs: string | null;
    createdAt: string;
  }): PreviewAction =>
    ({
      id,
      slackUserId: 'U1',
      slackChannelId: channelId,
      slackThreadTs: threadTs,
      createdAt: new Date(createdAt),
      status: 'PENDING',
      expiresAt: new Date('2026-10-30T13:00:00.000Z'),
    }) as PreviewAction;

  const cards = [
    card({
      id: 'same-thread',
      channelId: 'C1',
      threadTs: '100.1',
      createdAt: '2026-10-30T10:00:00.000Z',
    }),
    card({
      id: 'other-thread',
      channelId: 'C1',
      threadTs: '200.2',
      createdAt: '2026-10-30T11:50:00.000Z',
    }),
    card({
      id: 'other-channel',
      channelId: 'C2',
      threadTs: '100.1',
      createdAt: '2026-10-30T11:50:00.000Z',
    }),
    card({
      id: 'legacy',
      channelId: null,
      threadTs: null,
      createdAt: '2026-10-30T11:50:00.000Z',
    }),
  ];

  const repository = {
    findPendingAnswerCandidates: jest
      .fn()
      .mockImplementation(
        async (
          input: Parameters<
            PreviewActionRepositoryPort['findPendingAnswerCandidates']
          >[0],
        ) =>
          cards
            .filter((preview) => preview.slackUserId === input.slackUserId)
            .filter((preview) => preview.expiresAt > input.now)
            .filter(
              (preview) =>
                input.slackChannelId === undefined ||
                preview.slackChannelId === input.slackChannelId,
            )
            .filter(
              (preview) =>
                input.slackThreadTs === undefined ||
                preview.slackThreadTs === input.slackThreadTs,
            )
            .filter(
              (preview) =>
                input.createdSince === undefined ||
                preview.createdAt >= input.createdSince,
            )
            .slice(0, input.limit),
      ),
  } as unknown as PreviewActionRepositoryPort;
  const usecase = new FindAnswerablePreviewUsecase(repository);

  it('스레드 답변은 오래된 카드라도 정확한 채널과 스레드 한 장만 선택한다', async () => {
    const result = await usecase.execute({
      slackUserId: 'U1',
      now: NOW,
      scope: { kind: 'SLACK_THREAD', channelId: 'C1', threadTs: '100.1' },
    });
    expect(result).toEqual({ status: 'ONE', preview: cards[0] });
  });

  it('다른 스레드의 답변은 최신 카드와 좌표 없는 과거 카드를 선택하지 않는다', async () => {
    const result = await usecase.execute({
      slackUserId: 'U1',
      now: NOW,
      scope: { kind: 'SLACK_THREAD', channelId: 'C1', threadTs: '300.3' },
    });
    expect(result).toEqual({ status: 'NONE' });
  });

  it('최상위 답변은 오래된 카드와 다른 채널 및 좌표 없는 카드를 제외한다', async () => {
    const result = await usecase.execute({
      slackUserId: 'U1',
      now: NOW,
      scope: { kind: 'SLACK_TOP_LEVEL', channelId: 'C2' },
    });
    expect(result).toEqual({ status: 'ONE', preview: cards[2] });
  });

  it('콘솔 답변은 좌표와 무관하게 최근 30분 카드가 여럿이면 선택하지 않는다', async () => {
    const result = await usecase.execute({
      slackUserId: 'U1',
      now: NOW,
      scope: { kind: 'CONSOLE' },
    });
    expect(result).toEqual({ status: 'AMBIGUOUS' });
  });
});
