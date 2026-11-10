import { HANJA_PATTERN } from './saju-fortune-chat';
import { FORBIDDEN_TERMS_PATTERN } from './saju-fortune-render';
import {
  MISSION_CATALOG,
  MissionAnalysis,
  pickMission,
  renderMissionLine,
} from './saju-mission';

const analysisWith = ({
  work = 3,
  people = 3,
  money = 3,
  condition = 3,
  element = '불',
}: {
  work?: number;
  people?: number;
  money?: number;
  condition?: number;
  element?: MissionAnalysis['lucky']['element'];
}): MissionAnalysis =>
  ({
    scores: {
      총운: 3,
      '일·공부': work,
      '사람 관계': people,
      돈: money,
      컨디션: condition,
    },
    lucky: { element },
  }) as MissionAnalysis;

const allMissions = Object.values(MISSION_CATALOG).flatMap((byElement) =>
  Object.values(byElement).flat(),
);

describe('MISSION_CATALOG', () => {
  it('4항목 × 5오행 × 2 = 40개이고 키가 모두 다르다', () => {
    expect(allMissions).toHaveLength(40);
    expect(new Set(allMissions.map(({ key }) => key)).size).toBe(40);
  });

  it('모든 문구가 30자 이하이고 & < > · 미션 · 🎯 · 한자 · 금지 용어가 없다', () => {
    for (const { text } of allMissions) {
      expect(text.length).toBeLessThanOrEqual(30);
      expect(text).not.toMatch(/[&<>]|미션|🎯/);
      expect(text).not.toMatch(HANJA_PATTERN);
      expect(text).not.toMatch(FORBIDDEN_TERMS_PATTERN);
    }
  });
});

describe('pickMission', () => {
  it('가장 낮은 항목의 오늘 행운 기운 후보 중 첫 번째를 고른다', () => {
    const mission = pickMission({
      analysis: analysisWith({ work: 4, people: 2, condition: 4 }),
      recent: [],
      fortuneDate: '2026-11-10',
    });

    expect(mission).toEqual(MISSION_CATALOG['사람 관계']['불'][0]);
  });

  it('최저점 동점은 날짜마다 돌아간다', () => {
    const analysis = analysisWith({ work: 2, money: 2 });

    const today = pickMission({
      analysis,
      recent: [],
      fortuneDate: '2026-11-10',
    });
    const tomorrow = pickMission({
      analysis,
      recent: [],
      fortuneDate: '2026-11-11',
    });

    const picked = [today, tomorrow].map(
      (mission) => mission === MISSION_CATALOG['일·공부']['불'][0],
    );
    expect(picked).toContain(true);
    expect(picked).toContain(false);
    expect([MISSION_CATALOG['돈']['불'][0]]).toContain(
      picked[0] ? tomorrow : today,
    );
  });

  it('네 항목이 모두 4점 이상이면 네 항목 전체를 날짜로 돌린다', () => {
    const analysis = analysisWith({
      work: 5,
      people: 4,
      money: 4,
      condition: 4,
    });
    const dates = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];

    const keys = dates.map(
      (fortuneDate) => pickMission({ analysis, recent: [], fortuneDate }).key,
    );

    expect(new Set(keys).size).toBe(4);
  });

  it('첫 후보가 최근에 나갔으면 두 번째를 고른다', () => {
    const [first, second] = MISSION_CATALOG['사람 관계']['불'];

    const mission = pickMission({
      analysis: analysisWith({ people: 2 }),
      recent: [{ missionKey: first.key, fortuneDate: '2026-11-08' }],
      fortuneDate: '2026-11-10',
    });

    expect(mission).toEqual(second);
  });

  it('둘 다 나갔으면 덜 최근에 나간 쪽을 고른다', () => {
    const [first, second] = MISSION_CATALOG['사람 관계']['불'];

    const mission = pickMission({
      analysis: analysisWith({ people: 2 }),
      recent: [
        { missionKey: first.key, fortuneDate: '2026-11-09' },
        { missionKey: second.key, fortuneDate: '2026-11-01' },
      ],
      fortuneDate: '2026-11-10',
    });

    expect(mission).toEqual(second);
  });

  it('같은 입력이면 같은 미션', () => {
    const input = {
      analysis: analysisWith({ work: 2, money: 2, element: '물' }),
      recent: [],
      fortuneDate: '2026-11-10',
    };

    expect(pickMission(input)).toEqual(pickMission(input));
  });
});

describe('renderMissionLine', () => {
  it('🎯 오늘의 미션 줄을 그린다', () => {
    expect(
      renderMissionLine({
        key: 'k',
        text: '책상 위 물건 세 개만 제자리에 두기',
      }),
    ).toBe('🎯 오늘의 미션: 책상 위 물건 세 개만 제자리에 두기');
  });
});
