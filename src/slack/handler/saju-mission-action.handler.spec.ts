import { App } from '@slack/bolt';

import { AnswerMissionUsecase } from '../../saju-fortune-cron/application/answer-mission.usecase';
import { BuildCardCollectionUsecase } from '../../saju-fortune-cron/application/build-card-collection.usecase';
import { SajuMissionAction } from '../../saju-fortune-cron/application/saju-mission-check.formatter';
import { CardCollagePort } from '../../saju-fortune-cron/domain/port/card-collage.port';
import {
  MissionResult,
  SajuFortuneDayRepositoryPort,
} from '../../saju-fortune-cron/domain/port/saju-fortune-day.repository.port';
import { SajuMissionActionHandler } from './saju-mission-action.handler';

type ActionHandler = (args: {
  ack: jest.Mock;
  body: unknown;
  respond: jest.Mock;
  client: {
    chat: { update: jest.Mock };
    filesUploadV2: jest.Mock;
  };
}) => Promise<void>;

const bodyOf = (value: string) => ({
  user: { id: 'U111' },
  actions: [{ value }],
  container: { channel_id: 'D1', message_ts: '111.222' },
});

// 마지막으로 다시 그린 메시지의 본문.
const lastSectionTextOf = ({ update }: { update: jest.Mock }): string =>
  update.mock.calls.at(-1)[0].blocks[0].text.text;

const buildHarness = () => {
  const handlers = new Map<string, ActionHandler>();
  const app = {
    action: jest.fn((actionId: string, handler: ActionHandler) => {
      handlers.set(actionId, handler);
    }),
  } as unknown as App;
  // 저장소는 실제처럼 마지막 답을 기억한다 — 겹친 클릭에서 "마지막 저장값" 을 확인하려고.
  const stored: { result?: MissionResult } = {};
  const repository = {
    answerMission: jest.fn(({ result }: { result: MissionResult }) => {
      stored.result = result;
      return Promise.resolve(true);
    }),
    findMissionDay: jest.fn(() =>
      Promise.resolve({
        fortuneDate: '2026-11-10',
        missionText: '물 한 컵 천천히 마시기',
        missionResult: stored.result,
        createdAt: new Date('2026-11-09T23:00:00Z'),
      }),
    ),
    countDone: jest.fn().mockResolvedValue(2),
    findCards: jest.fn().mockResolvedValue([
      { fortuneDate: '2026-11-01', thumbnail: Buffer.from('a') },
      { fortuneDate: '2026-11-02', thumbnail: Buffer.from('b') },
    ]),
  };
  const renderer = {
    renderCards: jest.fn().mockResolvedValue(Buffer.from('collage')),
  };
  // 유스케이스는 실제 것을 쓴다 — 저장소·렌더러만 흉내 내 핸들러와 유스케이스 흐름을 함께 본다.
  const fortuneDays = repository as unknown as SajuFortuneDayRepositoryPort;
  new SajuMissionActionHandler(
    new AnswerMissionUsecase(fortuneDays),
    new BuildCardCollectionUsecase(
      fortuneDays,
      renderer as unknown as CardCollagePort,
    ),
  ).register(app);
  const ack = jest.fn().mockResolvedValue(undefined);
  const respond = jest.fn().mockResolvedValue(undefined);
  const client = {
    chat: { update: jest.fn().mockResolvedValue(undefined) },
    filesUploadV2: jest.fn().mockResolvedValue({ ok: true }),
  };
  const press = ({
    action,
    value = '2026-11-10',
  }: {
    action: SajuMissionAction;
    value?: string;
  }) => handlers.get(action)!({ ack, body: bodyOf(value), respond, client });
  return { press, repository, renderer, ack, respond, client };
};

describe('SajuMissionActionHandler', () => {
  it('했어: 저장 뒤 DB 를 다시 읽은 값으로 그 메시지를 다시 그린다', async () => {
    const { press, repository, client, ack } = buildHarness();

    await press({ action: SajuMissionAction.DONE });

    expect(ack).toHaveBeenCalled();
    expect(repository.answerMission).toHaveBeenCalledWith({
      slackUserId: 'U111',
      fortuneDate: '2026-11-10',
      result: MissionResult.DONE,
    });
    expect(repository.countDone).toHaveBeenCalledWith({
      slackUserId: 'U111',
      period: { from: '2026-11-09', until: '2026-11-16' },
    });
    expect(client.chat.update.mock.calls[0][0]).toMatchObject({
      channel: 'D1',
      ts: '111.222',
    });
    expect(lastSectionTextOf({ update: client.chat.update })).toContain(
      '✅ 했어! 이번 주 2번 해냈어',
    );
  });

  it('겹친 두 클릭: 마지막 화면은 마지막 저장값', async () => {
    const { press, client } = buildHarness();

    await Promise.all([
      press({ action: SajuMissionAction.DONE }),
      press({ action: SajuMissionAction.NOT_DONE }),
    ]);

    expect(client.chat.update).toHaveBeenCalledTimes(2);
    expect(lastSectionTextOf({ update: client.chat.update })).toContain(
      '🙂 괜찮아, 내일 또 있어',
    );
  });

  it.each(['2026-02-30', '', '2026/11/10'])(
    '잘못된 날짜 값(%p)이면 저장하지 않고 안내한다',
    async (value) => {
      const { press, repository, respond } = buildHarness();

      await press({ action: SajuMissionAction.DONE, value });

      expect(repository.answerMission).not.toHaveBeenCalled();
      expect(respond.mock.calls[0][0]).toMatchObject({
        response_type: 'ephemeral',
        text: '이 버튼은 더는 쓸 수 없어',
      });
    },
  );

  it('그날 행이 없으면 찾지 못했다고 안내한다', async () => {
    const { press, repository, respond, client } = buildHarness();
    repository.answerMission.mockResolvedValue(false);

    await press({ action: SajuMissionAction.DONE });

    expect(client.chat.update).not.toHaveBeenCalled();
    expect(respond.mock.calls[0][0].text).toBe('이 날 미션을 찾지 못했어');
  });

  it('저장이 던지면 다시 눌러 달라고 안내한다', async () => {
    const { press, repository, respond, client } = buildHarness();
    repository.answerMission.mockRejectedValue(new Error('db down'));

    await press({ action: SajuMissionAction.DONE });

    expect(client.chat.update).not.toHaveBeenCalled();
    expect(respond.mock.calls[0][0].text).toBe('저장하지 못했어, 다시 눌러 줘');
  });

  it('카드 모음: 모으는 중 안내 → 그달 카드로 격자 → 확인 메시지 스레드에 올린다', async () => {
    const { press, repository, renderer, respond, client } = buildHarness();

    await press({ action: SajuMissionAction.CARD_COLLECTION });

    expect(respond.mock.calls[0][0]).toMatchObject({
      response_type: 'ephemeral',
      text: '모으는 중이야…',
    });
    expect(repository.findCards).toHaveBeenCalledWith({
      slackUserId: 'U111',
      period: { from: '2026-11-01', until: '2026-12-01' },
    });
    expect(renderer.renderCards).toHaveBeenCalledTimes(1);
    expect(client.filesUploadV2.mock.calls[0][0]).toMatchObject({
      channel_id: 'D1',
      thread_ts: '111.222',
      file: Buffer.from('collage'),
      title: '🃏 11월 카드 모음 2장',
    });
  });

  it('카드가 없으면 올리지 않고 안내한다', async () => {
    const { press, repository, respond, client } = buildHarness();
    repository.findCards.mockResolvedValue([]);

    await press({ action: SajuMissionAction.CARD_COLLECTION });

    expect(client.filesUploadV2).not.toHaveBeenCalled();
    expect(respond.mock.calls.at(-1)[0].text).toBe('아직 모은 카드가 없어');
  });

  it('모음을 만들거나 올리다 실패하면 잠시 뒤 다시 눌러 달라고 한다', async () => {
    const { press, respond, client } = buildHarness();
    client.filesUploadV2.mockRejectedValue(new Error('missing_scope'));

    await press({ action: SajuMissionAction.CARD_COLLECTION });

    expect(respond.mock.calls.at(-1)[0].text).toBe(
      '지금은 못 만들었어, 잠시 뒤 다시 눌러 줘',
    );
  });
});
