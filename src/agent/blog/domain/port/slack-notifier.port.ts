export const BLOG_SLACK_NOTIFIER_PORT = Symbol('BLOG_SLACK_NOTIFIER_PORT');

export interface BlogSlackNotifyInput {
  channel: string;
  threadTs?: string;
  text: string;
}

// 비동기 BLOG worker 가 백그라운드 완료 후 같은 Slack 스레드에 답장하기 위한 포트.
// 구현(SlackWebNotifier)은 WebClient.chat.postMessage 로 전송하며, 토큰 미설정/전송 실패는
// 모두 swallow 한다(백그라운드 안정성 — unhandled rejection 방지).
export interface BlogSlackNotifierPort {
  notify(input: BlogSlackNotifyInput): Promise<void>;
}
