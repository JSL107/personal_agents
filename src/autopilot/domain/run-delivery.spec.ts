import { SlackDeliveryStatRow } from '../../slack/domain/port/slack-delivery.repository.port';
import { isRunResultDelivered } from './run-delivery';

const row = (
  overrides: Partial<SlackDeliveryStatRow>,
): SlackDeliveryStatRow => ({
  kind: 'autopilot:morning',
  itemKinds: ['morning-briefing'],
  threadTs: null,
  status: 'SENT',
  suppressReason: null,
  reactionCount: 0,
  replyCount: 0,
  ...overrides,
});

describe('isRunResultDelivered', () => {
  it('아침 계획은 그룹 본문(스레드 아님)이 SENT 여야 본 것이다', () => {
    expect(
      isRunResultDelivered({ agentType: 'PM', deliveries: [row({})] }),
    ).toBe(true);
    expect(
      isRunResultDelivered({
        agentType: 'PM',
        deliveries: [row({ threadTs: '1.0' })],
      }),
    ).toBe(false);
  });

  // PO 본문은 아침 메시지의 댓글로 나간다 — 스레드 행도 센다.
  it('PO 는 그 task 의 스레드 행도 발송으로 센다', () => {
    expect(
      isRunResultDelivered({
        agentType: 'PO_SHADOW',
        deliveries: [
          row({
            kind: 'autopilot:noon',
            itemKinds: ['po-shadow'],
            threadTs: '1.0',
          }),
        ],
      }),
    ).toBe(true);
  });

  it('SENT 가 아니거나 다른 task 의 행이면 나가지 않은 것이다', () => {
    expect(
      isRunResultDelivered({
        agentType: 'EVENING_RETRO',
        deliveries: [
          row({
            kind: 'autopilot:evening',
            itemKinds: ['evening-retro-publish'],
            status: 'FAILED',
          }),
          row({
            kind: 'autopilot:evening',
            itemKinds: ['blog-github-publish'],
          }),
        ],
      }),
    ).toBe(false);
  });

  it('모르는 agentType 은 확인할 길이 없어 나가지 않은 것으로 본다', () => {
    expect(
      isRunResultDelivered({
        agentType: 'CODE_REVIEWER',
        deliveries: [row({})],
      }),
    ).toBe(false);
  });
});
