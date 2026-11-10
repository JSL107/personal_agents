import { MissionResult } from '../domain/port/saju-fortune-day.repository.port';
import {
  buildMissionCheckBlocks,
  missionCheckFallbackText,
  SajuMissionAction,
} from './saju-mission-check.formatter';

interface Button {
  action_id: string;
  value: string;
  text: { text: string };
}

const VIEW = {
  fortuneDate: '2026-11-10',
  missionText: '책상 위 물건 세 개만 제자리에 두기',
  weekDone: 0,
};

const sectionTextOf = (blocks: Record<string, unknown>[]): string =>
  (blocks[0] as { text: { text: string } }).text.text;

const buttonsOf = (blocks: Record<string, unknown>[]): Button[] =>
  (blocks[1] as { elements: Button[] }).elements;

describe('buildMissionCheckBlocks', () => {
  it('답 전: 질문 문구·미션·세 버튼, 버튼 값은 날짜', () => {
    const blocks = buildMissionCheckBlocks(VIEW);

    expect(sectionTextOf(blocks)).toContain('오늘의 미션 어땠어?');
    expect(sectionTextOf(blocks)).toContain('답 안 해도 괜찮아');
    expect(sectionTextOf(blocks)).toContain(VIEW.missionText);
    const buttons = buttonsOf(blocks);
    expect(buttons.map(({ action_id }) => action_id)).toEqual([
      SajuMissionAction.DONE,
      SajuMissionAction.NOT_DONE,
      SajuMissionAction.CARD_COLLECTION,
    ]);
    expect(new Set(buttons.map(({ value }) => value))).toEqual(
      new Set(['2026-11-10']),
    );
  });

  it('했어: 완료 문구와 이번 주 횟수, 버튼은 바꾸기·모음', () => {
    const blocks = buildMissionCheckBlocks({
      ...VIEW,
      result: MissionResult.DONE,
      weekDone: 3,
    });

    expect(sectionTextOf(blocks)).toContain('✅ 했어! 이번 주 3번 해냈어');
    expect(buttonsOf(blocks).map(({ action_id }) => action_id)).toEqual([
      SajuMissionAction.NOT_DONE,
      SajuMissionAction.CARD_COLLECTION,
    ]);
  });

  it('못 했어: 이번 주 횟수가 0 이면 횟수를 쓰지 않는다', () => {
    const blocks = buildMissionCheckBlocks({
      ...VIEW,
      result: MissionResult.NOT_DONE,
    });

    expect(sectionTextOf(blocks)).toContain('🙂 괜찮아, 내일 또 있어');
    expect(sectionTextOf(blocks)).not.toContain('번 해냈어');
    expect(buttonsOf(blocks).map(({ action_id }) => action_id)).toEqual([
      SajuMissionAction.DONE,
      SajuMissionAction.CARD_COLLECTION,
    ]);
  });

  it('못 했어: 이번 주 횟수가 있으면 함께 쓴다', () => {
    const blocks = buildMissionCheckBlocks({
      ...VIEW,
      result: MissionResult.NOT_DONE,
      weekDone: 2,
    });

    expect(sectionTextOf(blocks)).toContain('이번 주 2번 해냈어');
  });

  it('모음 버튼 이름은 버튼 날짜의 달', () => {
    const blocks = buildMissionCheckBlocks({
      ...VIEW,
      fortuneDate: '2026-10-31',
    });

    const collection = buttonsOf(blocks).find(
      ({ action_id }) => action_id === SajuMissionAction.CARD_COLLECTION,
    );
    expect(collection?.text.text).toBe('🃏 10월 카드 모음');
  });

  it('미션 문구의 & < > 를 escape 한다', () => {
    const blocks = buildMissionCheckBlocks({
      ...VIEW,
      missionText: '물 & <차>',
    });

    expect(sectionTextOf(blocks)).toContain('물 &amp; &lt;차&gt;');
  });
});

describe('missionCheckFallbackText', () => {
  it('알림용 대체 문구에 미션을 싣는다', () => {
    expect(missionCheckFallbackText(VIEW)).toBe(
      '🎯 오늘의 미션 어땠어? 책상 위 물건 세 개만 제자리에 두기',
    );
  });
});
