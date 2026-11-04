import { SlackMention } from '../slack-collector.type';

export const SLACK_COLLECTOR_PORT = Symbol('SLACK_COLLECTOR_PORT');

// Slack WebClient 인스턴스 자체를 주입하기 위한 DI 토큰. 어댑터 외부에서 직접 참조하지 않으며,
// `SlackWebApiCollector` 의 생성자에서만 주입받아 테스트 시 mock client 로 교체 가능하게 한다.
export const SLACK_WEB_CLIENT = Symbol('SLACK_WEB_CLIENT');

export interface ListMyMentionsOptions {
  slackUserId: string;
  sinceHours?: number;
  // 채널/메시지 fetch 안전망. 봇이 합류한 채널이 너무 많을 때 폭주 방지.
  maxChannels?: number;
  maxMessagesPerChannel?: number;
  failOnChannelError?: boolean;
}

export interface SlackCollectorPort {
  listMyMentions(options: ListMyMentionsOptions): Promise<SlackMention[]>;
  getPermalink(channelId: string, ts: string): Promise<string | undefined>;
}
