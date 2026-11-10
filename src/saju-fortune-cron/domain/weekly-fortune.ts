import { starsOf } from './saju-fortune-render';
import { FORTUNE_SCORE_KEYS, FortuneScoreKey } from './saju-tables';

// 월요일 주간 운세 — 7일 별점은 application(weekly-scores)이 날마다 계산해 넘기고, 여기서는 고르고 그리기만 한다.
export const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DailyScores {
  date: string;
  weekday: Weekday;
  scores: Record<FortuneScoreKey, number>;
}

export interface WeeklyHighlight {
  good?: Weekday;
  careful?: Weekday;
}

// 4·5점은 "좋은 날", 2점은 "조심할 날"(1단계 SCORE_TONES 와 같은 경계).
const GOOD_SCORE = 4;
const CAREFUL_SCORE = 2;
const DAYS_IN_WEEK = 7;
const MILLISECONDS_PER_DAY = 86_400_000;
// Date.UTC 의 getUTCDay 기준 월요일.
const MONDAY = 1;

// todayKst 'YYYY-MM-DD'. 서버 시간대와 무관하게 날짜만으로 요일을 본다.
export const isMondayKst = (todayKst: string): boolean => {
  const weekday = new Date(`${todayKst}T00:00:00Z`).getUTCDay();
  return weekday === MONDAY;
};

export const weekDatesFrom = (mondayKst: string): string[] => {
  const start = new Date(`${mondayKst}T00:00:00Z`).getTime();
  const dates = Array.from({ length: DAYS_IN_WEEK }, (_, offset) =>
    new Date(start + offset * MILLISECONDS_PER_DAY).toISOString().slice(0, 10),
  );
  return dates;
};

// 항목마다 좋은 요일(4점 이상 중 최고점)·조심할 요일(2점) 하나씩. 동점이면 이른 요일(사용자 결정).
export const pickWeeklyHighlights = (
  days: DailyScores[],
): Record<FortuneScoreKey, WeeklyHighlight> => {
  const highlights: Record<FortuneScoreKey, WeeklyHighlight> = {
    총운: highlightOf(days, '총운'),
    '일·공부': highlightOf(days, '일·공부'),
    '사람 관계': highlightOf(days, '사람 관계'),
    돈: highlightOf(days, '돈'),
    컨디션: highlightOf(days, '컨디션'),
  };
  return highlights;
};

const highlightOf = (
  days: DailyScores[],
  key: FortuneScoreKey,
): WeeklyHighlight => {
  const best = Math.max(...days.map(({ scores }) => scores[key]));
  const goodDay =
    best >= GOOD_SCORE
      ? days.find(({ scores }) => scores[key] === best)
      : undefined;
  const carefulDay = days.find(({ scores }) => scores[key] === CAREFUL_SCORE);
  const highlight: WeeklyHighlight = {
    ...(goodDay ? { good: goodDay.weekday } : {}),
    ...(carefulDay ? { careful: carefulDay.weekday } : {}),
  };
  return highlight;
};

// '월 ★★★☆☆ · 화 ★★★★★ · …' — 요일별 총운. 코드가 그린다.
export const renderWeeklyStarLine = (days: DailyScores[]): string => {
  const parts = days.map(
    ({ weekday, scores }) => `${weekday} ${starsOf(scores['총운'])}`,
  );
  return parts.join(' · ');
};

// AI 에 주는 주간 사실. 숫자·별은 싣지 않는다 — 별점 줄은 코드가 따로 그린다.
export const formatWeeklyFacts = (days: DailyScores[]): string[] => {
  const highlights = pickWeeklyHighlights(days);
  const facts = FORTUNE_SCORE_KEYS.map(
    (key) => `- ${key}: ${describeHighlight(highlights[key])}`,
  );
  return facts;
};

const describeHighlight = ({ good, careful }: WeeklyHighlight): string => {
  const parts = [
    ...(good ? [`좋은 날 ${good}요일`] : []),
    ...(careful ? [`조심할 날 ${careful}요일`] : []),
  ];
  if (parts.length === 0) {
    return '이번 주는 특별히 좋은 날도 조심할 날도 없다(요일을 쓰지 마라)';
  }
  return parts.join(', ');
};
