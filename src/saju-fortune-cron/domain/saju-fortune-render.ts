// AI 가 쓴 운세 본문을 받아 보낼 글로 다듬는다. 별점·행운 아이템은 AI 글 속 라벨에 끼우지 않고
// 코드가 따로 한 줄씩 그린다 — 라벨 형식(줄 머리 이모지·`**총운:**`)이 흔들려도 항상 나가게.
import { LuckyInfo, SajuDayAnalysis } from './saju-analysis';
import { HANJA_PATTERN } from './saju-fortune-chat';
import { FORTUNE_SCORE_KEYS, FortuneScoreKey } from './saju-tables';

// 일상어와 겹치는 상관·쇠·병·사·양·절·목욕·관대·정인(사람 이름)은 넣지 않는다 — 정상 문장이 걸려 매번 재생성된다.
// 일간은 기간을 뜻하는 "일주일간·3일간" 과 겹쳐 앞 글자가 숫자·주 이면 제외한다.
export const FORBIDDEN_TERMS_PATTERN =
  /편재|정재|식신|편관|정관|비견|겁재|편인|십성|십이운성|12운성|장생|건록|제왕|공망|지장간|삼합|반합|천간합|용신|(?<![0-9주])일간/;
// 별 문자와 '총운 5점' 같은 숫자 별점 — 코드가 그린 별점 줄과 어긋날 수 있다.
const STAR_PATTERN = /[★☆]|\d\s*점/;
const LUCKY_PATTERN = /행운의 숫자|행운 숫자|행운 아이템/;

export type FortuneViolation = 'hanja' | 'term' | 'stars' | 'lucky';

const VIOLATION_PATTERNS: ReadonlyArray<readonly [FortuneViolation, RegExp]> = [
  ['hanja', HANJA_PATTERN],
  ['term', FORBIDDEN_TERMS_PATTERN],
  ['stars', STAR_PATTERN],
  ['lucky', LUCKY_PATTERN],
];

// 별 문자·행운 숫자 줄은 composeFortuneBody 가 지우므로 응답을 고를 때 덜 나쁘다.
const REMOVABLE_VIOLATIONS: ReadonlySet<FortuneViolation> = new Set([
  'stars',
  'lucky',
]);

export const countUnremovableViolations = (
  violations: FortuneViolation[],
): number =>
  violations.filter((kind) => !REMOVABLE_VIOLATIONS.has(kind)).length;

// 위반 종류 목록(종류마다 한 번). 길이가 "위반 수" 다.
export const findFortuneViolations = (text: string): FortuneViolation[] => {
  const matched = VIOLATION_PATTERNS.filter(([, pattern]) =>
    pattern.test(text),
  );
  return matched.map(([kind]) => kind);
};

// 두 번 다 위반한 응답도 실패 조건(AI 가 쓴 별·행운 숫자)을 뚫지 않게 하는 최종 방어.
// 🍀 로 시작하는 줄을 지우면 AI 의 "🍀 행운 포인트:" 까지 지워져 문구로 거른다.
export const stripInventedMarks = (body: string): string => {
  const kept = body.split('\n').filter((line) => !LUCKY_PATTERN.test(line));
  const cleaned = kept.map((line) => line.replace(/\s*[★☆]+/g, ''));
  return cleaned.join('\n');
};

// 예산 안의 마지막 완결 줄까지. 첫 줄만으로 넘치면 그 줄을 글자 단위로 자른다 — 본문이 비지 않게.
export const truncateByLines = ({
  body,
  budget,
}: {
  body: string;
  budget: number;
}): string => {
  const lines = body.split('\n');
  if (lines[0].length > budget) {
    return lines[0].slice(0, budget);
  }
  const kept = [lines[0]];
  let length = lines[0].length;
  for (const line of lines.slice(1)) {
    length += 1 + line.length;
    if (length > budget) {
      break;
    }
    kept.push(line);
  }
  return kept.join('\n');
};

const MAXIMUM_STARS = 5;

const starsOf = (score: number): string => {
  const filled = '★'.repeat(score);
  const empty = '☆'.repeat(MAXIMUM_STARS - score);
  return `${filled}${empty}`;
};

export const renderStarLine = (
  scores: Record<FortuneScoreKey, number>,
): string => {
  const parts = FORTUNE_SCORE_KEYS.map(
    (key) => `${key} ${starsOf(scores[key])}`,
  );
  return parts.join(' · ');
};

export const renderItemLine = (lucky: LuckyInfo): string =>
  `🍀 행운 아이템: ${lucky.color} · ${lucky.number} · ${lucky.taste}(${lucky.food}) · ${lucky.direction}`;

// escape 전 길이 기준(지금 발송 코드도 escape 전에 자른다). 그린 두 줄과 그 개행 둘은 예산에서 먼저 뺀다.
export const composeFortuneBody = ({
  body,
  analysis,
  maximum,
}: {
  body: string;
  analysis: SajuDayAnalysis;
  maximum: number;
}): string => {
  const starLine = renderStarLine(analysis.scores);
  const itemLine = renderItemLine(analysis.lucky);
  const budget = maximum - starLine.length - itemLine.length - 2;
  const truncated = truncateByLines({
    body: stripInventedMarks(body).trim(),
    budget,
  });
  const [firstLine, ...rest] = truncated.split('\n');
  return [firstLine, starLine, ...rest, itemLine].join('\n');
};
