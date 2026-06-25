import { WebClient } from '@slack/web-api';

import { SlackWebNotifier } from './slack-web.notifier';

// SlackWebNotifier 는 비동기 BLOG 완료 후 같은 스레드에 답장한다.
// 백그라운드 안정성 — 토큰 미설정(client=null)/전송 실패는 모두 swallow(throw 안 함).
describe('SlackWebNotifier', () => {
  it('chat.postMessage 를 channel/thread_ts/text 로 호출한다', async () => {
    const postMessage = jest.fn().mockResolvedValue({ ok: true });
    const notifier = new SlackWebNotifier({
      chat: { postMessage },
    } as unknown as WebClient);

    await notifier.notify({ channel: 'C1', threadTs: 'T1', text: '완료' });

    expect(postMessage).toHaveBeenCalledWith({
      channel: 'C1',
      thread_ts: 'T1',
      text: '완료',
    });
  });

  it('threadTs 가 없으면 thread_ts 없이 호출한다(채널 최상위 메시지)', async () => {
    const postMessage = jest.fn().mockResolvedValue({ ok: true });
    const notifier = new SlackWebNotifier({
      chat: { postMessage },
    } as unknown as WebClient);

    await notifier.notify({ channel: 'C1', text: '완료' });

    expect(postMessage).toHaveBeenCalledWith({ channel: 'C1', text: '완료' });
  });

  it('postMessage 실패는 swallow 한다(throw 안 함)', async () => {
    const postMessage = jest.fn().mockRejectedValue(new Error('boom'));
    const notifier = new SlackWebNotifier({
      chat: { postMessage },
    } as unknown as WebClient);

    await expect(
      notifier.notify({ channel: 'C1', text: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('client 가 null 이면 noop(throw 안 함)', async () => {
    const notifier = new SlackWebNotifier(null);

    await expect(
      notifier.notify({ channel: 'C1', text: 'x' }),
    ).resolves.toBeUndefined();
  });
});
