import { addDaysTo, weekdayOf } from '../../common/util/kst-date.util';
import { starsOf } from './saju-fortune-render';
import { FORTUNE_SCORE_KEYS, FortuneScoreKey } from './saju-tables';

// 월요일 주간 운세 — 7일 별점은 application(weekly-scores)이 날마다 계산해 넘기고, 여기서는 고르고 그리기만 한다.
// 월요일부터의 순서 그대로 — 주간 7일과 짝지을 때 Object.values 순서를 쓴다.
export enum Weekday {
  월 = '월',
  화 = '화',
  수 = '수',
  목 = '목',
  금 = '금',
  토 = '토',
  일 = '일',
}
export const WEEKDAYS: readonly Weekday[] = Object.values(Weekday);

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
// weekdayOf 기준 월요일.
const MONDAY = 1;

export const isMondayKst = (todayKst: string): boolean => {
  const isMonday = weekdayOf(todayKst) === MONDAY;
  return isMonday;
};

export const weekDatesFrom = (mondayKst: string): string[] => {
  const dates = WEEKDAYS.map((_, offset) => addDaysTo(mondayKst, offset));
  return dates;
};

// 항목마다 좋은 요일(4점 이상 중 최고점)·조심할 요일(2점) 하나씩. 동점이면 이른 요일(사용자 결정).
export const pickWeeklyHighlights = (
  days: DailyScores[],
): Record<FortuneScoreKey, WeeklyHighlight> => {
  const highlights: Record<FortuneScoreKey, WeeklyHighlight> = {
    [FortuneScoreKey.총운]: highlightOf({ days, key: FortuneScoreKey.총운 }),
    [FortuneScoreKey.일공부]: highlightOf({
      days,
      key: FortuneScoreKey.일공부,
    }),
    [FortuneScoreKey.사람관계]: highlightOf({
      days,
      key: FortuneScoreKey.사람관계,
    }),
    [FortuneScoreKey.돈]: highlightOf({ days, key: FortuneScoreKey.돈 }),
    [FortuneScoreKey.컨디션]: highlightOf({
      days,
      key: FortuneScoreKey.컨디션,
    }),
  };
  return highlights;
};

const highlightOf = ({
  days,
  key,
}: {
  days: DailyScores[];
  key: FortuneScoreKey;
}): WeeklyHighlight => {
  const best = Math.max(...days.map(({ scores }) => scores[key]));
  const bestDay = days.find(({ scores }) => scores[key] === best);
  const goodDay = best >= GOOD_SCORE ? bestDay : undefined;
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
    ({ weekday, scores }) =>
      `${weekday} ${starsOf(scores[FortuneScoreKey.총운])}`,
  );
  const starLine = parts.join(' · ');
  return starLine;
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
  const joined = parts.join(', ');
  return joined;
};
