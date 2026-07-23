export const SLACK_NOTIFIER_PORT = Symbol('SLACK_NOTIFIER_PORT');

// OPS-7: MorningBriefingConsumer (Infrastructure) 가 SlackService (Slack 어댑터) 를 직접 의존하지 않도록
// 발송 책임만 추상화한 도메인 port. SlackModule 의 SlackService 가 이 port 의 useExisting 로 bind 되며,
// 향후 다른 알림 어댑터 (Telegram / Discord 등) 도입 시 Consumer 변경 없이 모듈 wiring 만 바꾸면 된다.
export interface SlackNotifierPort {
  // target: 슬랙 user ID(`U...`) / 채널 ID(`C.../G...`) — chat.postMessage 의 channel 파라미터.
  // threadTs 지정 시 해당 메시지의 스레드 댓글로 발송. 반환 ts 는 후속 스레드 발송용.
  postMessage(input: {
    target: string;
    text: string;
    threadTs?: string;
  }): Promise<{ ts: string | undefined }>;
  // T1_PREVIEW preview 버튼 메시지. 반환된 좌표(channelId/messageTs)로 이후 chat.update(카드 갱신)가 가능.
  postPreviewMessage(input: {
    target: string;
    previewText: string;
    previewId: string;
  }): Promise<{ channelId: string; messageTs: string }>;
}
