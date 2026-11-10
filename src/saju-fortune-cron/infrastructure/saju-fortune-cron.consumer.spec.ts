import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { SlackNotifierPort } from '../../slack/domain/port/slack-notifier.port';
import { CardCollagePort } from '../domain/port/card-collage.port';
import { FortuneCardImagePort } from '../domain/port/fortune-card-image.port';
import { SajuFortuneDayRepositoryPort } from '../domain/port/saju-fortune-day.repository.port';
import { fortuneDateOf } from '../domain/saju-fortune-chat';
import { SajuFortuneCronJobData } from '../domain/saju-fortune-cron.type';
import * as renderModule from '../domain/saju-fortune-render';
import { SajuFortuneCronConsumer } from './saju-fortune-cron.consumer';

const RECIPIENTS = 'U111|길동|丙寅 辛卯 壬戌 庚子;U222|철수|戊辰 甲寅 癸亥';
// 실행 날짜에 따라 주간·특집 메시지가 붙으므로 시각을 고정한다.
// 2026-11-10 09:00 KST = 화요일, 특별한 날 아님.
const ORDINARY_DAY = new Date('2026-11-10T00:00:00Z');
// 2026-11-16 09:00 KST = 월요일(갑오일), 특별한 날 아님.
const MONDAY = new Date('2026-11-16T00:00:00Z');
const JOB = {
  name: 'saju-fortune-cron',
  data: { recipientSlackUserIds: ['U111', 'U222'] },
} as Job<SajuFortuneCronJobData>;

describe('SajuFortuneCronConsumer', () => {
  let route: jest.Mock;
  let postMessage: jest.Mock;
  let acquireOnce: jest.Mock;
  let release: jest.Mock;
  let isDone: jest.Mock;
  let publishCronFailure: jest.Mock;
  let generateImage: jest.Mock;
  let uploadImageFile: jest.Mock;
  let recordSent: jest.Mock;
  let findMissionKeys: jest.Mock;
  let toThumbnail: jest.Mock;
  let findMissionDay: jest.Mock;
  let consumer: SajuFortuneCronConsumer;
  let recipients: string;
  let missionCheckCron: string | undefined;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(ORDINARY_DAY);
    recipients = RECIPIENTS;
    missionCheckCron = undefined;
    route = jest
      .fn()
      .mockResolvedValue({ text: '🌊 물이 물을 만난 날 <!channel>' });
    postMessage = jest.fn().mockResolvedValue(undefined);
    acquireOnce = jest.fn().mockResolvedValue(true);
    release = jest.fn().mockResolvedValue(undefined);
    isDone = jest.fn().mockResolvedValue(false);
    publishCronFailure = jest.fn();
    generateImage = jest.fn().mockResolvedValue(Buffer.from('png'));
    uploadImageFile = jest.fn().mockResolvedValue({ fileId: 'F1' });
    recordSent = jest.fn().mockResolvedValue(undefined);
    findMissionKeys = jest.fn().mockResolvedValue([]);
    toThumbnail = jest.fn().mockResolvedValue(Buffer.from('jpg'));
    findMissionDay = jest.fn().mockResolvedValue(undefined);
    consumer = new SajuFortuneCronConsumer(
      {
        get: (key: string) =>
          key === 'SAJU_MISSION_CHECK_CRON' ? missionCheckCron : recipients,
      } as unknown as ConfigService,
      { route } as unknown as ModelRouterUsecase,
      { postMessage, uploadImageFile } as unknown as SlackNotifierPort,
      { acquireOnce, release, isDone } as unknown as CronIdempotencyService,
      { generate: generateImage } as FortuneCardImagePort,
      {
        recordSent,
        findMissionKeys,
        findMissionDay,
      } as unknown as SajuFortuneDayRepositoryPort,
      { toThumbnail } as unknown as CardCollagePort,
      {
        publishCronFailure,
        publishRecovery: jest.fn(),
      } as unknown as NotificationPublisher,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('받는 사람마다 PM 을 빌려 머리말 없이 부르고, 각자에게 이스케이프된 DM 을 보낸다', async () => {
    await consumer.process(JOB);

    expect(route).toHaveBeenCalledTimes(2);
    expect(route.mock.calls[0][0]).toMatchObject({
      agentType: AgentType.PM,
      noContractPreamble: true,
    });
    expect(postMessage.mock.calls.map(([input]) => input.target)).toEqual([
      'U111',
      'U222',
    ]);
    const text: string = postMessage.mock.calls[0][0].text;
    expect(text).toMatch(
      /^🔮 \*오늘의 운세 — \d{4}-\d{2}-\d{2} \([가-힣]{2}일\)\*/,
    );
    expect(text).toContain('&lt;!channel&gt;');
    expect(text).not.toContain('丙寅');
  });

  it('한 사람의 LLM 이 실패해도 다른 사람은 받고, 실패한 사람은 가드를 잡지 않은 채 owner 에게 알린다', async () => {
    route
      .mockRejectedValueOnce(new Error('codex 쿼터'))
      .mockResolvedValueOnce({ text: '좋은 날' });

    await expect(consumer.process(JOB)).rejects.toThrow(
      '사주 운세 발송 실패 1/2명: 길동',
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].target).toBe('U222');
    expect(acquireOnce).toHaveBeenCalledTimes(1);
    expect(acquireOnce.mock.calls[0][0]).toContain(':U222:');
    expect(publishCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: 'Saju Fortune Cron' }),
    );
  });

  it('발송이 실패하면 잡았던 가드를 풀어 재시도가 다시 보내게 한다', async () => {
    postMessage.mockRejectedValueOnce(new Error('slack 500'));

    await expect(consumer.process(JOB)).rejects.toThrow('1/2명: 길동');

    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0]).toContain(':U111:');
  });

  it('이 잡이 맡은 시각의 사람에게만 보낸다', async () => {
    await consumer.process({
      name: 'saju-fortune-cron',
      data: { recipientSlackUserIds: ['U222'] },
    } as Job<SajuFortuneCronJobData>);

    expect(route).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls.map(([input]) => input.target)).toEqual([
      'U222',
    ]);
  });

  it('한자가 섞이면 한 번 다시 만들어 한자 없는 쪽을 보낸다', async () => {
    route
      .mockResolvedValueOnce({ text: '己土는 오늘 癸水를 만난다' })
      .mockResolvedValueOnce({ text: '흙 기운이 물을 만나는 날이야' })
      .mockResolvedValueOnce({ text: '쇠 기운이 반짝이는 날이야' });

    await consumer.process(JOB);

    expect(route).toHaveBeenCalledTimes(3);
    expect(postMessage.mock.calls[0][0].text).toContain('흙 기운이 물을');
  });

  it('두 번 다 한자가 섞이면 마지막 응답을 그대로 보낸다', async () => {
    route.mockResolvedValue({ text: '癸水의 날' });

    await consumer.process(JOB);

    expect(route).toHaveBeenCalledTimes(4);
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it('두 번 다 위반이면 위반 종류가 적은 응답을 보낸다', async () => {
    route
      .mockResolvedValueOnce({ text: '癸水의 날' })
      .mockResolvedValueOnce({ text: '편재가 들어온 壬水' })
      .mockResolvedValueOnce({ text: '편재가 들어온 丙火' })
      .mockResolvedValueOnce({ text: '癸水가 반짝여' });

    await consumer.process(JOB);

    // 길동: 첫 응답(한자 1종)이 두 번째(한자+용어 2종)보다 적다. 철수: 두 번째가 적다.
    expect(postMessage.mock.calls[0][0].text).toContain('癸水의 날');
    expect(postMessage.mock.calls[0][0].text).not.toContain('壬水');
    expect(postMessage.mock.calls[1][0].text).toContain('癸水가 반짝여');
  });

  it('위반 종류 수가 같으면 코드가 지울 수 있는 별 위반 쪽을 보낸다', () => {
    route
      .mockResolvedValueOnce({ text: '맑은 날이야 ★★★' })
      .mockResolvedValueOnce({ text: '癸水의 날' })
      .mockResolvedValue({ text: '좋은 날' });

    return consumer.process(JOB).then(() => {
      const text: string = postMessage.mock.calls[0][0].text;
      expect(text).toContain('맑은 날이야');
      expect(text).not.toContain('癸水');
    });
  });

  it('AI 가 쓴 별·행운 숫자는 지우고, 첫 줄 뒤 별점 줄과 끝의 행운 아이템 줄은 코드가 그린다', async () => {
    route.mockResolvedValue({
      text: '맑은 날이야\n\n총운 ★★★★★: 좋아\n행운의 숫자: 7',
    });

    await consumer.process(JOB);

    const text: string = postMessage.mock.calls[0][0].text;
    const bodyLines = text.split('\n\n').slice(1).join('\n\n').split('\n');
    expect(bodyLines[0]).toBe('맑은 날이야');
    expect(bodyLines[1]).toMatch(/^총운 [★☆]{5} · 일·공부 [★☆]{5}/);
    expect(bodyLines.at(-2)).toMatch(/^🍀 행운 아이템: /);
    expect(bodyLines.at(-1)).toMatch(/^🎯 오늘의 미션: /);
    expect(text).not.toContain('행운의 숫자');
    expect(text).not.toContain('★★★★★: 좋아');
    expect(fortuneDateOf(text)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('카드 두 줄은 본문에서 떼어 그림으로 그리고, 그림과 글을 한 메시지로 보낸다', async () => {
    route.mockResolvedValue({
      text: '좋은 날이야\n\nCARD_TITLE: THE QUIET SUN\nCARD_SCENE: A golden sun over a field.',
    });

    await consumer.process(JOB);

    expect(generateImage.mock.calls[0][0]).toContain('THE QUIET SUN');
    expect(generateImage.mock.calls[0][0]).toContain('A golden sun');
    const [input] = postMessage.mock.calls[0];
    expect(input.text).toContain('좋은 날이야');
    expect(input.text).not.toContain('CARD_');
    expect(input.image).toEqual({
      fileId: 'F1',
      altText: '오늘의 운세 카드 — THE QUIET SUN',
    });
  });

  it('그림 생성이 실패해도 글만은 보낸다', async () => {
    route.mockResolvedValue({
      text: '좋은 날이야\nCARD_TITLE: THE QUIET SUN\nCARD_SCENE: A sun.',
    });
    generateImage.mockRejectedValue(new Error('codex 시간 초과'));

    await consumer.process(JOB);

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[0][0].image).toBeUndefined();
    expect(postMessage.mock.calls[0][0].text).toContain('좋은 날이야');
  });

  it('그림을 붙인 발송이 실패하면 글만 한 번 더 보내고 가드는 유지한다', async () => {
    route.mockResolvedValue({
      text: '좋은 날이야\nCARD_TITLE: THE QUIET SUN\nCARD_SCENE: A sun.',
    });
    postMessage
      .mockRejectedValueOnce(new Error('invalid_blocks'))
      .mockResolvedValue(undefined);

    await consumer.process(JOB);

    const forFirst = postMessage.mock.calls.filter(
      ([input]) => input.target === 'U111',
    );
    expect(forFirst).toHaveLength(2);
    expect(forFirst[0][0].image).toBeDefined();
    expect(forFirst[1][0].image).toBeUndefined();
    expect(forFirst[1][0].text).toContain('좋은 날이야');
    expect(release).not.toHaveBeenCalled();
  });

  it('카드 줄이 없으면 그림을 만들지 않는다', async () => {
    await consumer.process(JOB);

    expect(generateImage).not.toHaveBeenCalled();
    expect(postMessage.mock.calls[0][0].image).toBeUndefined();
  });

  describe('오늘의 미션과 하루 기록', () => {
    const CARD_RESPONSE =
      '좋은 날이야\nCARD_TITLE: THE QUIET SUN\nCARD_SCENE: A sun.';

    it('발송 뒤 고른 미션·AI 본문·카드를 기록한다', async () => {
      route.mockResolvedValue({ text: CARD_RESPONSE });

      await consumer.process(JOB);

      expect(recordSent).toHaveBeenCalledTimes(2);
      const [day] = recordSent.mock.calls[0];
      expect(day).toMatchObject({
        slackUserId: 'U111',
        fortuneDate: '2026-11-10',
        aiBody: '좋은 날이야',
        card: { title: 'THE QUIET SUN', thumbnail: Buffer.from('jpg') },
      });
      expect(toThumbnail).toHaveBeenCalledWith(Buffer.from('png'));
      expect(postMessage.mock.calls[0][0].text).toContain(
        `🎯 오늘의 미션: ${day.missionText}`,
      );
      expect(postMessage.mock.invocationCallOrder[0]).toBeLessThan(
        recordSent.mock.invocationCallOrder[0],
      );
    });

    it('최근 미션은 오늘 이전 14일을 묻는다', async () => {
      await consumer.process(JOB);

      expect(findMissionKeys).toHaveBeenCalledWith({
        slackUserId: 'U111',
        period: { from: '2026-10-27', until: '2026-11-10' },
      });
    });

    it('진 실행(다른 실행이 키를 잡음)은 기록하지 않는다', async () => {
      acquireOnce.mockResolvedValue(false);

      await consumer.process(JOB);

      expect(postMessage).not.toHaveBeenCalled();
      expect(recordSent).not.toHaveBeenCalled();
    });

    it('기록이 실패해도 잡은 성공하고 Redis 키를 풀지 않는다', async () => {
      recordSent.mockRejectedValue(new Error('db down'));

      await expect(consumer.process(JOB)).resolves.toBeUndefined();

      expect(postMessage).toHaveBeenCalledTimes(2);
      expect(release).not.toHaveBeenCalled();
    });

    it('그림 첨부가 실패해 글만 나가면 카드 없이 기록한다', async () => {
      route.mockResolvedValue({ text: CARD_RESPONSE });
      postMessage
        .mockRejectedValueOnce(new Error('invalid_blocks'))
        .mockResolvedValue(undefined);

      await consumer.process(JOB);

      expect(recordSent.mock.calls[0][0].card).toBeUndefined();
      expect(recordSent.mock.calls[1][0].card).toBeDefined();
    });

    it('썸네일 변환이 실패하면 카드 없이 기록한다', async () => {
      route.mockResolvedValue({ text: CARD_RESPONSE });
      toThumbnail.mockRejectedValue(new Error('sharp'));

      await consumer.process(JOB);

      expect(recordSent).toHaveBeenCalledTimes(2);
      expect(recordSent.mock.calls[0][0].card).toBeUndefined();
    });

    it('최근 미션 조회가 실패해도 미션 줄을 붙여 보낸다', async () => {
      findMissionKeys.mockRejectedValue(new Error('db down'));

      await consumer.process(JOB);

      expect(postMessage).toHaveBeenCalledTimes(2);
      expect(postMessage.mock.calls[0][0].text).toContain('🎯 오늘의 미션:');
    });
  });

  it('오늘 이미 보낸 사람은 LLM 도 부르지 않는다', async () => {
    isDone.mockResolvedValue(true);

    await consumer.process(JOB);

    expect(route).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  describe('월요일·특별한 날 추가 메시지', () => {
    const textsFor = (target: string): string[] =>
      postMessage.mock.calls
        .filter(([input]) => input.target === target)
        .map(([input]) => input.text);

    it('월요일엔 모든 사람의 일일을 먼저 보내고 그다음 이번 주 운세를 보낸다', async () => {
      jest.setSystemTime(MONDAY);

      await consumer.process(JOB);

      const sent = postMessage.mock.calls.map(([input]) => [
        input.target,
        input.text.split('\n')[0],
      ]);
      expect(sent).toEqual([
        ['U111', '🔮 *오늘의 운세 — 2026-11-16 (갑오일)*'],
        ['U222', '🔮 *오늘의 운세 — 2026-11-16 (갑오일)*'],
        ['U111', '🔮 *이번 주 운세 — 2026-11-16 (갑오일)*'],
        ['U222', '🔮 *이번 주 운세 — 2026-11-16 (갑오일)*'],
      ]);
      expect(textsFor('U111')[1]).toMatch(/월 [★☆]{5} · 화 [★☆]{5}/);
      expect(acquireOnce.mock.calls[2][0]).toBe(
        'cron:saju-fortune-cron:extra:U111:2026-11-16',
      );
    });

    it('평범한 날엔 추가 메시지 LLM 도 가드도 없다', async () => {
      await consumer.process(JOB);

      expect(route).toHaveBeenCalledTimes(2);
      expect(isDone.mock.calls.map(([key]) => key)).not.toContainEqual(
        expect.stringContaining(':extra:'),
      );
    });

    it('생일이면 특별한 날 메시지를 특집 줄과 함께 보낸다', async () => {
      recipients = 'U111|길동|丙寅 辛卯 壬戌 庚子||11-10';

      await consumer.process({
        name: 'saju-fortune-cron',
        data: { recipientSlackUserIds: ['U111'] },
      } as Job<SajuFortuneCronJobData>);

      const [, extra] = textsFor('U111');
      expect(extra.split('\n')[0]).toBe('🔮 *특별한 날 — 2026-11-10 (무자일)*');
      expect(extra).toContain('🎂 생일 축하해, 길동!');
      expect(extra).not.toContain('🍀 행운 아이템');
    });

    it('일일이 실패한 사람은 추가를 건너뛰고, 다른 사람은 둘 다 받는다', async () => {
      jest.setSystemTime(MONDAY);
      postMessage.mockRejectedValueOnce(new Error('slack 500'));

      await expect(consumer.process(JOB)).rejects.toThrow(
        '사주 운세 발송 실패 1/2명: 길동',
      );

      expect(textsFor('U111')).toHaveLength(1);
      expect(textsFor('U222')).toHaveLength(2);
    });

    it('추가만 실패하면 추가 키만 풀고 문구 끝에 추가 실패를 붙인다', async () => {
      jest.setSystemTime(MONDAY);
      postMessage
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('slack 500'));

      await expect(consumer.process(JOB)).rejects.toThrow(' / 추가 실패: 길동');

      expect(release.mock.calls.map(([key]) => key)).toEqual([
        'cron:saju-fortune-cron:extra:U111:2026-11-16',
      ]);
    });

    it('재시도에서 일일은 이미 보냈으면 건너뛰고 추가만 보낸다', async () => {
      jest.setSystemTime(MONDAY);
      isDone.mockImplementation(
        async (key: string) => !key.includes(':extra:'),
      );

      await consumer.process(JOB);

      expect(
        postMessage.mock.calls.map(([input]) => input.text.split('\n')[0]),
      ).toEqual([
        '🔮 *이번 주 운세 — 2026-11-16 (갑오일)*',
        '🔮 *이번 주 운세 — 2026-11-16 (갑오일)*',
      ]);
    });

    it('다른 실행이 일일을 보내는 중(raced)이면 그 사람 추가는 건너뛴다', async () => {
      jest.setSystemTime(MONDAY);
      acquireOnce.mockImplementation(
        async (key: string) => !key.endsWith(':U111:2026-11-16'),
      );

      await consumer.process(JOB);

      expect(textsFor('U111')).toEqual([]);
      expect(textsFor('U222')).toHaveLength(2);
    });

    it('일일 본문 조립이 던지면 가드를 잡기 전이라 키가 남지 않는다', async () => {
      jest.spyOn(renderModule, 'composeFortuneBody').mockImplementation(() => {
        throw new Error('조립 실패');
      });

      await expect(consumer.process(JOB)).rejects.toThrow('2/2명');

      expect(acquireOnce).not.toHaveBeenCalled();
    });

    it('구간 수가 어긋난 추가 응답은 한 번 다시 만든다', async () => {
      jest.setSystemTime(MONDAY);
      recipients = 'U111|길동|丙寅 辛卯 壬戌 庚子||11-16';
      route
        .mockResolvedValueOnce({ text: '좋은 날' })
        .mockResolvedValueOnce({ text: '구간 하나뿐' })
        .mockResolvedValueOnce({ text: '생일 이야기\n=====\n이번 주 이야기' });

      await consumer.process({
        name: 'saju-fortune-cron',
        data: { recipientSlackUserIds: ['U111'] },
      } as Job<SajuFortuneCronJobData>);

      expect(route).toHaveBeenCalledTimes(3);
      const [, extra] = textsFor('U111');
      expect(extra).toContain('🎂 생일 축하해, 길동!\n생일 이야기');
      expect(extra).toMatch(/월 [★☆]{5}[^\n]*\n이번 주 이야기/);
    });

    it('두 번 다 구간 수가 어긋나면 구분줄을 지우고 코드 줄을 맨 앞에 모아 보낸다', async () => {
      jest.setSystemTime(MONDAY);
      recipients = 'U111|길동|丙寅 辛卯 壬戌 庚子||11-16';
      route
        .mockResolvedValueOnce({ text: '좋은 날' })
        .mockResolvedValueOnce({ text: '구간 하나뿐' })
        .mockResolvedValueOnce({ text: '하나\n=====\n둘\n=====\n셋' });

      await consumer.process({
        name: 'saju-fortune-cron',
        data: { recipientSlackUserIds: ['U111'] },
      } as Job<SajuFortuneCronJobData>);

      expect(route).toHaveBeenCalledTimes(3);
      const [, extra] = textsFor('U111');
      expect(extra).toMatch(
        /🎂 생일 축하해, 길동!\n월 [★☆]{5}[^\n]*\n\n하나\n둘\n셋$/,
      );
      expect(extra).not.toContain('=====');
    });
  });

  describe('저녁 미션 확인', () => {
    // 21:00 KST 회차. 아침 기록은 08:00 KST.
    const SCHEDULED = new Date('2026-11-10T12:00:00Z');
    const MORNING = new Date('2026-11-09T23:00:00Z');
    const missionJob = (prevMillis: number) =>
      ({
        name: 'saju-mission-check',
        data: {},
        opts: { prevMillis },
      }) as unknown as Job<SajuFortuneCronJobData>;
    const dayOf = (overrides: Record<string, unknown> = {}) => ({
      fortuneDate: '2026-11-10',
      missionText: '물 한 컵 천천히 마시기',
      createdAt: MORNING,
      ...overrides,
    });

    beforeEach(() => {
      jest.setSystemTime(SCHEDULED);
    });

    it('예정 시각의 날짜 행을 보고, 답이 없고 3시간 지난 사람에게 버튼 DM 을 보낸다', async () => {
      findMissionDay.mockImplementation(({ slackUserId }) =>
        Promise.resolve(slackUserId === 'U111' ? dayOf() : undefined),
      );

      await consumer.process(missionJob(SCHEDULED.getTime()));

      expect(findMissionDay).toHaveBeenCalledWith({
        slackUserId: 'U111',
        fortuneDate: '2026-11-10',
      });
      expect(postMessage).toHaveBeenCalledTimes(1);
      const [input] = postMessage.mock.calls[0];
      expect(input.target).toBe('U111');
      expect(input.blocks).toBeDefined();
      expect(input.text).toContain('물 한 컵 천천히 마시기');
      expect(acquireOnce.mock.calls[0][0]).toBe(
        'cron:saju-fortune-cron:mission:U111:2026-11-10',
      );
      expect(route).not.toHaveBeenCalled();
    });

    it('자정을 넘겨 도는 보충 잡도 예정 시각 날짜(전날)를 쓴다', async () => {
      // 22:00 KST 회차가 다음 날 00:30 KST 에 돈다(2.5시간 지연 — 창 안).
      const scheduled = new Date('2026-11-10T13:00:00Z');
      jest.setSystemTime(new Date('2026-11-10T15:30:00Z'));
      findMissionDay.mockResolvedValue(dayOf());

      await consumer.process(missionJob(scheduled.getTime()));

      expect(findMissionDay.mock.calls[0][0].fortuneDate).toBe('2026-11-10');
      expect(postMessage).toHaveBeenCalled();
    });

    it('예정 시각에서 3시간을 넘겨 돌면 아무에게도 보내지 않는다', async () => {
      jest.setSystemTime(new Date('2026-11-10T15:30:00Z'));
      findMissionDay.mockResolvedValue(dayOf());

      await consumer.process(missionJob(SCHEDULED.getTime()));

      expect(findMissionDay).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalled();
    });

    it.each([
      ['이미 답한 사람', { missionResult: 'done' }],
      [
        '아침 기록 뒤 3시간이 안 된 사람',
        { createdAt: new Date('2026-11-10T10:00:00Z') },
      ],
    ])('%s 은 건너뛴다', async (_, overrides) => {
      findMissionDay.mockResolvedValue(dayOf(overrides));

      await consumer.process(missionJob(SCHEDULED.getTime()));

      expect(postMessage).not.toHaveBeenCalled();
    });

    it('env 에서 빠진 사람은 보지 않는다', async () => {
      recipients = 'U222|철수|戊辰 甲寅 癸亥';
      findMissionDay.mockResolvedValue(dayOf());

      await consumer.process(missionJob(SCHEDULED.getTime()));

      expect(findMissionDay.mock.calls.map(([key]) => key.slackUserId)).toEqual(
        ['U222'],
      );
    });

    it('이미 보낸 날(키가 있음)은 다시 보내지 않는다', async () => {
      findMissionDay.mockResolvedValue(dayOf());
      isDone.mockResolvedValue(true);

      await consumer.process(missionJob(SCHEDULED.getTime()));

      expect(postMessage).not.toHaveBeenCalled();
    });

    // 켜진 채 등록된 저녁 회차를 놓친 뒤 off 로 다시 켜면 부팅 보충이 그 회차를 넣는다(#1018 Codex 리뷰).
    it('SAJU_MISSION_CHECK_CRON=off 면 보충 잡이 와도 보내지 않는다', async () => {
      missionCheckCron = 'off';
      findMissionDay.mockResolvedValue(dayOf());

      await consumer.process(missionJob(SCHEDULED.getTime()));

      expect(findMissionDay).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalled();
    });

    it('발송이 실패하면 키를 풀고 저녁 사건 이름으로 알린다', async () => {
      findMissionDay.mockImplementation(({ slackUserId }) =>
        Promise.resolve(slackUserId === 'U111' ? dayOf() : undefined),
      );
      postMessage.mockRejectedValueOnce(new Error('slack 500'));

      await expect(
        consumer.process(missionJob(SCHEDULED.getTime())),
      ).rejects.toThrow('사주 미션 확인 실패 1/2명: 길동');

      expect(release).toHaveBeenCalledWith(
        'cron:saju-fortune-cron:mission:U111:2026-11-10',
      );
      expect(publishCronFailure).toHaveBeenCalledWith(
        expect.objectContaining({ cronName: 'Saju Mission Check' }),
      );
    });
  });
});
