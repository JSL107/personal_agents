import { retryPolicies, WebClient } from '@slack/web-api';

import { ScheduleItemRecord, ScheduleStatus } from '../domain/schedule.type';
import {
  SCHEDULE_SLACK_CLIENT_OPTIONS,
  ScheduleSlackNotifier,
} from './schedule-slack.notifier';

// 이 알림은 등록의 **결과 통지**이지 등록의 일부가 아니다. 그래서 이 스위트가 지키는 것은
// "보냈는가" 보다 **"어떤 경우에도 등록을 실패시키지 않는가"** 쪽이다 — 여기서 throw 가
// 새어 나가면 이미 저장된 일정에 대해 콘솔이 실패를 띄우고, 사용자는 같은 일정을 다시 넣는다.
describe('ScheduleSlackNotifier', () => {
  const record: ScheduleItemRecord = {
    id: 7,
    slackUserId: 'U123',
    title: '자동차세 납부',
    dueDate: new Date('2026-09-30T00:00:00.000Z'),
    dueTime: null,
    linkUrl: null,
    memo: null,
    status: ScheduleStatus.OPEN,
    completedAt: null,
    isHoliday: false,
  };

  it('등록한 소유자에게 DM 으로 보낸다 — 문구에 콘솔에서 들어왔음이 드러난다', async () => {
    const postMessage = jest.fn().mockResolvedValue({ ok: true });
    const notifier = new ScheduleSlackNotifier({
      chat: { postMessage },
    } as unknown as WebClient);

    await notifier.notifyRegistered(record);

    expect(postMessage).toHaveBeenCalledTimes(1);
    const sent = postMessage.mock.calls[0][0] as {
      channel: string;
      text: string;
    };
    expect(sent.channel).toBe('U123');
    expect(sent.text).toContain('자동차세 납부');
    // Slack 에 아무것도 치지 않았는데 온 알림이라, 어디서 들어왔는지가 본문에 있어야 한다.
    expect(sent.text).toContain('콘솔 캘린더');
  });

  it('SLACK_BOT_TOKEN 이 없으면(client=null) 조용히 건너뛴다 — 등록은 그대로 성공한다', async () => {
    const notifier = new ScheduleSlackNotifier(null);

    await expect(notifier.notifyRegistered(record)).resolves.toBeUndefined();
  });

  it('postMessage 실패를 삼킨다 — 발송 실패가 등록 응답을 실패로 만들지 않는다', async () => {
    const postMessage = jest.fn().mockRejectedValue(new Error('rate limited'));
    const notifier = new ScheduleSlackNotifier({
      chat: { postMessage },
    } as unknown as WebClient);

    await expect(notifier.notifyRegistered(record)).resolves.toBeUndefined();
  });

  // 이 발송은 등록 응답 경로 안에 있다. 기본값(무제한 timeout + 약 30분 10회 재시도)이
  // 남아 있으면 Slack 이 느린 동안 콘솔 요청이 먼저 끊기고, 사용자가 다시 넣어 같은 일정이
  // 둘이 된다 — 예외를 삼키는 것은 그 대기 시간을 줄이지 않는다.
  //
  // **옵션 객체의 값을 베껴 단언하지 않는다.** 그건 옵션을 넘기지 않아도 통과한다.
  // 실제로 만들어진 클라이언트가 무엇을 물고 있는지를 본다.
  it('알림용 클라이언트는 기본 재시도 정책(30분 10회)을 쓰지 않는다', () => {
    const client = new WebClient('xoxb-test', SCHEDULE_SLACK_CLIENT_OPTIONS);
    // `retryConfig` 는 private 이라 타입으로는 안 보이지만 런타임에는 그대로 있다. 옵션을
    // 넘겼는지가 아니라 **클라이언트가 무엇을 물었는지** 를 봐야 이 단언이 힘을 갖는다.
    const applied = client as unknown as { retryConfig: { retries?: number } };

    expect(retryPolicies.tenRetriesInAboutThirtyMinutes.retries).toBe(10);
    expect(applied.retryConfig.retries ?? 10).toBeLessThan(10);
    // 429 를 기다리면 위와 같은 일이 생긴다 — 기다리지 않고 실패로 받는다.
    expect(SCHEDULE_SLACK_CLIENT_OPTIONS.rejectRateLimitedCalls).toBe(true);
    expect(SCHEDULE_SLACK_CLIENT_OPTIONS.timeout).toBeGreaterThan(0);
  });
});
