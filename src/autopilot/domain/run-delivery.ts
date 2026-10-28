import { AgentType } from '../../model-router/domain/model-router.type';
import { SlackDeliveryStatRow } from '../../slack/domain/port/slack-delivery.repository.port';
import { SLACK_DELIVERY_STATUS } from '../../slack/domain/slack-delivery.type';

// 판정 대상 실행의 결과가 실린 발송의 원장 좌표 — 오케스트레이터가 그룹 본문과 그 스레드 댓글을
// `autopilot:<그룹>` · itemKinds=[taskId] 로 남긴다.
// `mainPostOnly`: 아침 계획은 그룹 본문(스레드 아님)이 나가야 본 것이다. 정오 PO 는 본문이 아침 메시지의
// 댓글로 나가므로(2026-10-22) 스레드 행도 센다. 저녁 회고도 같은 규칙으로 센다 — 상세·버튼 댓글은
// 본문이 성공한 뒤에만 나가므로, 그 task 의 SENT 행이 하나라도 있으면 본문이 나간 것이다.
const RUN_DELIVERY: Partial<
  Record<string, { kind: string; taskId: string; mainPostOnly: boolean }>
> = {
  [AgentType.PM]: {
    kind: 'autopilot:morning',
    taskId: 'morning-briefing',
    mainPostOnly: true,
  },
  [AgentType.EVENING_RETRO]: {
    kind: 'autopilot:evening',
    taskId: 'evening-retro-publish',
    mainPostOnly: false,
  },
  [AgentType.PO_SHADOW]: {
    kind: 'autopilot:noon',
    taskId: 'po-shadow',
    mainPostOnly: false,
  },
};

// 사람이 그 실행의 결과를 실제로 봤는가. 저녁 매일 버튼(아침 계획)과 월요일 주간 카드가 같은 기준으로
// "본 적 없는 결과" 를 판정에서 뺀다 — 한쪽만 바뀌면 같은 실행이 한쪽에서만 묻힌다.
// 원장에 agentRunId 가 없어 그룹·task·날짜로 맞춘다 — 호출부가 그날 하루 범위의 행만 넘긴다.
// 모르는 agentType 은 확인할 길이 없어 나가지 않은 것으로 본다.
export const isRunResultDelivered = (
  agentType: string,
  deliveries: SlackDeliveryStatRow[],
): boolean => {
  const target = RUN_DELIVERY[agentType];
  if (!target) {
    return false;
  }
  return deliveries.some(
    (delivery) =>
      delivery.kind === target.kind &&
      delivery.itemKinds.includes(target.taskId) &&
      (!target.mainPostOnly || delivery.threadTs === null) &&
      delivery.status === SLACK_DELIVERY_STATUS.SENT,
  );
};
