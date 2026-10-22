// 사용자에게 멘션된 Slack 메시지 한 건 — PM Agent 가 "blocker 후보" 로 모델에 넘긴다.
export interface SlackMention {
  channelId: string;
  channelName: string | undefined; // DM/IM 은 name 없음
  channelType: 'public_channel' | 'private_channel' | 'im' | 'mpim';
  authorUserId: string | undefined;
  // 봇(이대리 자신 포함)이 보낸 메시지. 사람이 부른 멘션과 갈라야 "계획 밖 새 요청" 이 자기 알림으로
  // 켜지지 않는다. 값이 없으면 판별 전 데이터다.
  fromBot?: boolean;
  ts: string; // Slack timestamp ("1730000000.000100")
  text: string;
  permalink: string | undefined;
}
