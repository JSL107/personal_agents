import { WebClient } from '@slack/web-api';

type RepliesResponse = Awaited<
  ReturnType<WebClient['conversations']['replies']>
>;
export type ReactedMessage = NonNullable<RepliesResponse['messages']>[number];

// 반응이 달린 메시지 본문을 ts 로 찾는다. 반응 핸들러는 전부 이 함수를 지난다.
//
// `conversations.history` 를 쓰면 안 된다 — 스레드 답글을 반환하지 않아 답글에 단 반응이
// 직전 최상위 메시지(대개 스레드 원글)로 바뀐다. 2026-10-15 스레드 답글 두 개에 📌 를 달았는데
// Notion 에는 두 번 다 원글이 적혔다.
//
// `conversations.replies` 는 답글 ts 로 부르면 그 답글만, 스레드 없는 최상위 메시지는 자기 자신을
// 돌려준다(2026-10-15 실측). 반환이 한 건이라는 보장은 없으니 ts 를 맞춰 본다 — 못 찾으면 엉뚱한
// 본문 대신 null.
//
// 예외: channel_join·channel_leave 메시지는 스레드가 될 수 없어 replies 가 thread_not_found 를
// 낸다(Slack 문서). 그때만 같은 ts 로 history 를 본다 — history 는 최상위 메시지라 찾을 수 있다.
export const findReactedMessage = async (
  client: WebClient,
  channel: string,
  ts: string,
): Promise<ReactedMessage | null> => {
  const isSameTs = (candidate: ReactedMessage): boolean => {
    return candidate.ts === ts;
  };
  try {
    const thread = await client.conversations.replies({
      channel,
      ts,
      inclusive: true,
      limit: 1,
    });
    return thread.messages?.find(isSameTs) ?? null;
  } catch (error) {
    if (!isThreadNotFound(error)) {
      throw error;
    }
    const history = await client.conversations.history({
      channel,
      oldest: ts,
      latest: ts,
      inclusive: true,
      limit: 1,
    });
    return history.messages?.find(isSameTs) ?? null;
  }
};

// Slack platform error 는 코드를 `data.error` 에 담는다(`WebAPIPlatformError`).
const isThreadNotFound = (error: unknown): boolean => {
  if (!error || typeof error !== 'object' || !('data' in error)) {
    return false;
  }
  const data = (error as { data: unknown }).data;
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { error?: unknown }).error === 'thread_not_found'
  );
};
