import { match } from 'ts-pattern';

import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import { MissionResult } from '../domain/port/saju-fortune-day.repository.port';
import { MissionCheckView } from '../domain/saju-mission-check';

// 저녁 미션 확인 메시지의 버튼 — SajuMissionActionHandler 가 같은 상수로 받는다. 값은 모두 그날 날짜(YYYY-MM-DD).
export enum SajuMissionAction {
  DONE = 'saju_mission_done',
  NOT_DONE = 'saju_mission_not_done',
  CARD_COLLECTION = 'saju_card_collection',
}

type SlackBlock = Record<string, unknown>;

const button = ({
  actionId,
  text,
  value,
}: {
  actionId: string;
  text: string;
  value: string;
}): SlackBlock => ({
  type: 'button',
  action_id: actionId,
  text: { type: 'plain_text', text, emoji: true },
  value,
});

// 오래된 메시지의 버튼도 그 메시지 날짜의 달을 뜻한다 — 이름에 달을 박아 둔다.
const collectionButtonOf = (fortuneDate: string): SlackBlock => {
  const month = Number(fortuneDate.slice(5, 7));
  const collection = button({
    actionId: SajuMissionAction.CARD_COLLECTION,
    text: `🃏 ${month}월 카드 모음`,
    value: fortuneDate,
  });
  return collection;
};

// 못 했다는 답에도 이번 주에 해낸 게 있으면 함께 보여 준다.
const notDoneHeadlineOf = (weekDone: number): string => {
  const comfort = '🙂 괜찮아, 내일 또 있어';
  if (weekDone === 0) {
    return comfort;
  }
  const headline = `${comfort} · 이번 주 ${weekDone}번 해냈어`;
  return headline;
};

// 꾸중하지 않는다 — 못 했다는 답에도 달성 수가 있으면 함께 보여 준다.
const headlineOf = ({ result, weekDone }: MissionCheckView): string => {
  const headline = match(result)
    .with(undefined, () => '🎯 *오늘의 미션 어땠어?* 답 안 해도 괜찮아')
    .with(MissionResult.DONE, () => `✅ 했어! 이번 주 ${weekDone}번 해냈어`)
    .with(MissionResult.NOT_DONE, () => notDoneHeadlineOf(weekDone))
    .exhaustive();
  return headline;
};

// 답하기 전엔 두 답 버튼, 답한 뒤엔 반대 답으로 바꾸는 버튼 하나. 카드 모음은 늘 있다.
const answerButtonsOf = ({
  result,
  fortuneDate,
}: MissionCheckView): SlackBlock[] => {
  const buttons = match(result)
    .with(undefined, () => [
      button({
        actionId: SajuMissionAction.DONE,
        text: '✅ 했어',
        value: fortuneDate,
      }),
      button({
        actionId: SajuMissionAction.NOT_DONE,
        text: '🙂 오늘은 못 했어',
        value: fortuneDate,
      }),
    ])
    .with(MissionResult.DONE, () => [
      button({
        actionId: SajuMissionAction.NOT_DONE,
        text: '못 했어로 바꾸기',
        value: fortuneDate,
      }),
    ])
    .with(MissionResult.NOT_DONE, () => [
      button({
        actionId: SajuMissionAction.DONE,
        text: '했어로 바꾸기',
        value: fortuneDate,
      }),
    ])
    .exhaustive();
  return buttons;
};

export const buildMissionCheckBlocks = (
  view: MissionCheckView,
): SlackBlock[] => {
  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${headlineOf(view)}\n${escapeSlackMrkdwn(view.missionText)}`,
      },
    },
    {
      type: 'actions',
      elements: [
        ...answerButtonsOf(view),
        collectionButtonOf(view.fortuneDate),
      ],
    },
  ];
  return blocks;
};

// 알림·검색용 대체 문구(블록이 있으면 본문으로는 안 보인다).
export const missionCheckFallbackText = ({
  missionText,
}: MissionCheckView): string => `🎯 오늘의 미션 어땠어? ${missionText}`;
