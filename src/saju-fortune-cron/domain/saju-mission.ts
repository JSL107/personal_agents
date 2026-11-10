import {
  countKstDaysBetween,
  utcMidnightOf,
} from '../../common/util/kst-date.util';
import { RecentMission } from './port/saju-fortune-day.repository.port';
import { FiveElement } from './saju-analysis';
import {
  FORTUNE_SCORE_KEYS,
  FortuneCategory,
  FortuneScoreKey,
} from './saju-tables';

// 오늘의 미션 — 코드가 목록에서 고르고 코드가 그린다. AI 에게는 알려 주지 않는다(설계 §4-2).
export interface Mission {
  key: string;
  text: string;
}

export type FortuneScores = Record<FortuneScoreKey, number>;

export interface LuckyElement {
  element: FiveElement;
}

// 미션 고르기에 필요한 분석값만 — SajuDayAnalysis 를 그대로 넘겨도 맞는다.
export interface MissionAnalysis {
  scores: FortuneScores;
  lucky: LuckyElement;
}

// 같은 항목·같은 행운 기운 안의 미션 후보 둘. 최근에 안 나간 쪽을 고른다.
export type MissionCandidates = readonly [Mission, Mission];
export type MissionsByElement = Record<FiveElement, MissionCandidates>;

interface PickMissionInput {
  analysis: MissionAnalysis;
  recent: RecentMission[];
  fortuneDate: string;
}
// 스레드 답변은 원문에서 이 라벨로 미션 줄을 찾는다 — Slack 이 🎯 를 :dart: 로 바꿔 돌려줄 수 있어 이모지로는 찾지 않는다.
export const MISSION_LABEL = '오늘의 미션:';
export const MISSION_LINE_PREFIX = `🎯 ${MISSION_LABEL}`;

// 네 항목이 모두 이 점수 이상이면 "약한 곳"이 없는 날로 보고 네 항목을 돌린다.
const STRONG_DAY_SCORE = 4;
// 날짜 순번의 기준일 — 값 자체는 의미가 없고 날마다 1씩 늘기만 하면 된다.
const DAY_INDEX_EPOCH = utcMidnightOf('2000-01-01');

// 하고 나면 기분이 조금 나아지는 작은 행동 — 해야 할 일 목록처럼 읽히지 않게 쓴다.
// 5분 안에, 돈·장소·남의 협조 없이 혼자 할 수 있는 일. 항목 × 오늘의 행운 기운마다 둘.
// 기운의 결: 나무 자라남·연결 / 불 밝음·표현 / 흙 느긋함·돌봄 / 쇠 매듭·또렷함 / 물 흐름·쉼.
// 키는 문구를 바꿔도 유지한다 — 최근 미션 회피가 키로 센다.
export const MISSION_CATALOG: Record<FortuneCategory, MissionsByElement> = {
  [FortuneScoreKey.일공부]: {
    [FiveElement.나무]: [
      { key: 'work-wood-1', text: '궁금했던 것 하나 찾아보고 메모하기' },
      { key: 'work-wood-2', text: '오늘 새로 알게 된 것 한 줄 남기기' },
    ],
    [FiveElement.불]: [
      { key: 'work-fire-1', text: '잘 해낸 일 하나 누군가에게 자랑하기' },
      { key: 'work-fire-2', text: '오늘 끝낸 일 하나 스스로 칭찬하기' },
    ],
    [FiveElement.흙]: [
      { key: 'work-earth-1', text: '제일 쉬운 일부터 하나 먼저 끝내기' },
      { key: 'work-earth-2', text: '좋아하는 펜으로 할 일 세 개 적기' },
    ],
    [FiveElement.쇠]: [
      { key: 'work-metal-1', text: '끝낸 일 하나에 체크 표시 크게 하기' },
      { key: 'work-metal-2', text: '일 하나에 마침표 찍고 잠깐 쉬기' },
    ],
    [FiveElement.물]: [
      { key: 'work-water-1', text: '5분만 딴생각 없이 한 가지에 빠져 보기' },
      { key: 'work-water-2', text: '막힌 일은 잠깐 걷고 와서 다시 보기' },
    ],
  },
  [FortuneScoreKey.사람관계]: {
    [FiveElement.나무]: [
      { key: 'people-wood-1', text: '고마웠던 사람에게 짧은 인사 보내기' },
      { key: 'people-wood-2', text: '오랜만인 사람에게 안부 한 줄 보내기' },
    ],
    [FiveElement.불]: [
      { key: 'people-fire-1', text: '오늘 나를 웃게 해 준 사람 떠올리기' },
      { key: 'people-fire-2', text: '누군가에게 먼저 웃으며 인사하기' },
    ],
    [FiveElement.흙]: [
      { key: 'people-earth-1', text: '상대 말을 끝까지 듣고 고개 끄덕이기' },
      { key: 'people-earth-2', text: '가족에게 오늘 있었던 일 하나 말하기' },
    ],
    [FiveElement.쇠]: [
      { key: 'people-metal-1', text: '고맙다는 말을 한 번 더 또렷하게 하기' },
      { key: 'people-metal-2', text: '미뤄 둔 답장 하나 다정하게 보내기' },
    ],
    [FiveElement.물]: [
      { key: 'people-water-1', text: '대화할 때 휴대폰 잠깐 내려놓기' },
      { key: 'people-water-2', text: '친구 이야기에 질문 하나 더 해 보기' },
    ],
  },
  [FortuneScoreKey.돈]: {
    [FiveElement.나무]: [
      { key: 'money-wood-1', text: '갖고 싶은 것 적어 두고 하루 기다리기' },
      { key: 'money-wood-2', text: '작은 저금 목표 하나 정해 보기' },
    ],
    [FiveElement.불]: [
      { key: 'money-fire-1', text: '요즘 제일 잘 산 물건 하나 떠올리기' },
      { key: 'money-fire-2', text: '장바구니 속 하나를 내일로 미루기' },
    ],
    [FiveElement.흙]: [
      { key: 'money-earth-1', text: '지갑 속 영수증 정리하며 한숨 돌리기' },
      { key: 'money-earth-2', text: '이번 달 나를 위한 작은 선물 정하기' },
    ],
    [FiveElement.쇠]: [
      { key: 'money-metal-1', text: '안 쓰는 구독이 있는지 한 번 살펴보기' },
      { key: 'money-metal-2', text: '오늘 쓴 돈을 한 줄로 적어 보기' },
    ],
    [FiveElement.물]: [
      { key: 'money-water-1', text: '돈 대신 산책으로 기분 내 보기' },
      { key: 'money-water-2', text: '이번 주 돈 쓸 곳 하나만 미리 정하기' },
    ],
  },
  [FortuneScoreKey.컨디션]: {
    [FiveElement.나무]: [
      { key: 'condition-wood-1', text: '창문 열고 1분 바깥 공기 마시기' },
      { key: 'condition-wood-2', text: '기지개 크게 켜고 어깨 세 번 돌리기' },
    ],
    [FiveElement.불]: [
      { key: 'condition-fire-1', text: '햇빛 드는 곳에서 5분 걷기' },
      { key: 'condition-fire-2', text: '좋아하는 노래 한 곡 크게 듣기' },
    ],
    [FiveElement.흙]: [
      { key: 'condition-earth-1', text: '따뜻한 차 한 잔 천천히 마시기' },
      { key: 'condition-earth-2', text: '밥 한 끼는 꼭꼭 씹어 천천히 먹기' },
    ],
    [FiveElement.쇠]: [
      { key: 'condition-metal-1', text: '숨 크게 세 번 쉬고 어깨 힘 빼기' },
      { key: 'condition-metal-2', text: '허리 펴고 바른 자세로 1분 앉기' },
    ],
    [FiveElement.물]: [
      { key: 'condition-water-1', text: '따뜻한 물 한 잔 들고 창밖 1분 보기' },
      { key: 'condition-water-2', text: '자기 전 10분은 화면 끄고 쉬기' },
    ],
  },
};

const MISSION_CATEGORIES = FORTUNE_SCORE_KEYS.filter(
  (key): key is FortuneCategory => key !== FortuneScoreKey.총운,
);

const dayIndexOf = (fortuneDate: string): number =>
  countKstDaysBetween(DAY_INDEX_EPOCH, utcMidnightOf(fortuneDate));

// 가장 낮은 항목들. 네 항목이 모두 높으면 약한 곳이 없는 날이라 네 항목 전부.
const weakestCategoriesOf = (scores: FortuneScores): FortuneCategory[] => {
  const lowest = Math.min(...MISSION_CATEGORIES.map((key) => scores[key]));
  if (lowest >= STRONG_DAY_SCORE) {
    return [...MISSION_CATEGORIES];
  }
  const weakest = MISSION_CATEGORIES.filter((key) => scores[key] === lowest);
  return weakest;
};

// 최근에 안 나간 후보를 앞에서부터, 둘 다 나갔으면 덜 최근 것(같으면 첫 번째).
const leastRecentOf = ({
  candidates,
  recent,
}: {
  candidates: MissionCandidates;
  recent: RecentMission[];
}): Mission => {
  const lastSentOf = (mission: Mission): string => {
    const found = recent.find(({ missionKey }) => missionKey === mission.key);
    const fortuneDate = found?.fortuneDate ?? '';
    return fortuneDate;
  };
  const [first, second] = candidates;
  const chosen = lastSentOf(second) < lastSentOf(first) ? second : first;
  return chosen;
};

// 같은 입력(별점·행운 기운·최근 기록·날짜) → 같은 미션. 동점 항목은 날짜 순번으로 돌린다.
export const pickMission = ({
  analysis,
  recent,
  fortuneDate,
}: PickMissionInput): Mission => {
  const categories = weakestCategoriesOf(analysis.scores);
  const category = categories[dayIndexOf(fortuneDate) % categories.length];
  const mission = leastRecentOf({
    candidates: MISSION_CATALOG[category][analysis.lucky.element],
    recent,
  });
  return mission;
};

export const renderMissionLine = ({ text }: Mission): string =>
  `${MISSION_LINE_PREFIX} ${text}`;
