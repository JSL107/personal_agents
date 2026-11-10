// AI 가 쓴 운세 본문을 받아 보낼 글로 다듬는다. 별점·행운 아이템은 AI 글 속 라벨에 끼우지 않고
// 코드가 따로 한 줄씩 그린다 — 라벨 형식(줄 머리 이모지·`**총운:**`)이 흔들려도 항상 나가게.
import { LuckyInfo, SajuDayAnalysis } from './saju-analysis';
import { HANJA_PATTERN } from './saju-fortune-chat';
import { Mission, renderMissionLine } from './saju-mission';
import { FORTUNE_SCORE_KEYS, FortuneScoreKey } from './saju-tables';

// 일상어와 겹치는 상관·쇠·병·사·양·절·목욕·관대·정인(사람 이름)은 넣지 않는다 — 정상 문장이 걸려 매번 재생성된다.
// 일간은 기간을 뜻하는 "일주일간·3일간" 과 겹쳐 앞 글자가 숫자·주 이면 제외한다.
export const FORBIDDEN_TERMS_PATTERN =
  /편재|정재|식신|편관|정관|비견|겁재|편인|십성|십이운성|12운성|장생|건록|제왕|공망|지장간|삼합|반합|천간합|용신|(?<![0-9주])일간/;
// 별 문자와 '총운 5점' 같은 숫자 별점 — 코드가 그린 별점 줄과 어긋날 수 있다.
const STAR_PATTERN = /[★☆]|\d\s*점/;
const LUCKY_PATTERN = /행운의 숫자|행운 숫자|행운 아이템/;
// AI 가 쓴 미션 줄 — 코드가 그린 미션 줄과 겹치지 않게 지우기만 한다. 재생성 사유는 아니다(지울 수 있고, 넣으면 LLM 호출만 는다).
const MISSION_PATTERN = /미션|🎯/;

export enum FortuneViolation {
  HANJA = 'hanja',
  TERM = 'term',
  STARS = 'stars',
  LUCKY = 'lucky',
  // 추가 운세 메시지의 구획 수 불일치 — 본문 검사 규칙이 아니라 deliver-extra-fortune 가 더한다.
  SECTIONS = 'sections',
}

const VIOLATION_PATTERNS: ReadonlyArray<readonly [FortuneViolation, RegExp]> = [
  [FortuneViolation.HANJA, HANJA_PATTERN],
  [FortuneViolation.TERM, FORBIDDEN_TERMS_PATTERN],
  [FortuneViolation.STARS, STAR_PATTERN],
  [FortuneViolation.LUCKY, LUCKY_PATTERN],
];

// 별 문자·행운 숫자 줄은 composeFortuneBody 가 지우므로 응답을 고를 때 덜 나쁘다.
const REMOVABLE_VIOLATIONS: ReadonlySet<FortuneViolation> = new Set([
  FortuneViolation.STARS,
  FortuneViolation.LUCKY,
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
  const kinds = matched.map(([kind]) => kind);
  return kinds;
};

// 두 번 다 위반한 응답도 실패 조건(AI 가 쓴 별·행운 숫자)을 뚫지 않게 하는 최종 방어.
// 🍀 로 시작하는 줄을 지우면 AI 의 "🍀 행운 포인트:" 까지 지워져 문구로 거른다.
export const stripInventedMarks = (body: string): string => {
  const kept = body
    .split('\n')
    .filter((line) => !LUCKY_PATTERN.test(line) && !MISSION_PATTERN.test(line));
  const cleaned = kept.map((line) => line.replace(/\s*[★☆]+/g, ''));
  const stripped = cleaned.join('\n');
  return stripped;
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
    const clipped = lines[0].slice(0, budget);
    return clipped;
  }
  const kept = [lines[0]];
  for (const line of lines.slice(1)) {
    // 줄을 하나 더 이으면(개행 포함) 예산을 넘는지 — 이어 붙인 글자 수 그대로 잰다.
    const joinedLength = [...kept, line].join('\n').length;
    if (joinedLength > budget) {
      break;
    }
    kept.push(line);
  }
  const truncated = kept.join('\n');
  return truncated;
};

const MAXIMUM_STARS = 5;

export const starsOf = (score: number): string => {
  const filled = '★'.repeat(score);
  const empty = '☆'.repeat(MAXIMUM_STARS - score);
  const starLine = `${filled}${empty}`;
  return starLine;
};

export const renderStarLine = (
  scores: Record<FortuneScoreKey, number>,
): string => {
  const parts = FORTUNE_SCORE_KEYS.map(
    (key) => `${key} ${starsOf(scores[key])}`,
  );
  const starLine = parts.join(' · ');
  return starLine;
};

export const renderItemLine = (lucky: LuckyInfo): string =>
  `🍀 행운 아이템: ${lucky.color} · ${lucky.number} · ${lucky.taste}(${lucky.food}) · ${lucky.direction}`;

// escape 전 길이 기준(지금 발송 코드도 escape 전에 자른다). 코드가 그리는 줄은 예산에서 먼저 뺀다 —
// 항목별 배치가 더 길므로 그 몫을 떼면 별점 줄 폴백도 예산 안에 든다.
// 다섯 항목 라벨을 모두 찾으면 항목마다 굵은 라벨과 별을 붙이고 빈 줄로 띄운다(가독성). 하나라도 못 찾으면
// 첫 줄 뒤에 별점 줄 하나를 붙이는 예전 배치로 돌아간다 — 별점은 어느 경우에도 빠지지 않는다.
// 미션 줄은 행운 아이템 줄 바로 뒤에 붙여 한 덩어리로 다룬다 — 두 배치와 예산 계산이 같은 값을 쓴다.
export interface ComposedFortune {
  // 코드가 그린 줄까지 붙인 발송 본문(escape 전).
  body: string;
  // 가드·잘림을 거친 AI 본문 — 코드가 그린 줄 없음. 하루 기록에 남겨 전날과 비교한다.
  aiBody: string;
}

export const composeFortuneBody = ({
  body,
  analysis,
  mission,
  maximum,
}: {
  body: string;
  analysis: SajuDayAnalysis;
  mission: Mission;
  maximum: number;
}): ComposedFortune => {
  const itemLine = [
    renderItemLine(analysis.lucky),
    renderMissionLine(mission),
  ].join('\n');
  const truncated = truncateByLines({
    body: stripInventedMarks(body).trim(),
    budget: maximum - itemLayoutOverhead(itemLine),
  });
  const [firstLine, ...rest] = truncated.split('\n');
  const items = findScoreItems(rest);
  if (!items) {
    const starLine = renderStarLine(analysis.scores);
    const legacy: ComposedFortune = {
      body: [firstLine, starLine, ...rest, itemLine].join('\n'),
      aiBody: truncated,
    };
    return legacy;
  }
  const blocks = FORTUNE_SCORE_KEYS.map(
    (key) => `*${key}* ${starsOf(analysis.scores[key])}\n${items.texts[key]}`,
  );
  const beforeItems = items.others.before.map(boldTailLabel);
  const afterItems = items.others.after.map(boldTailLabel);
  const layout = [
    firstLine,
    ...beforeItems,
    '',
    blocks.join('\n\n'),
    '',
    itemLine,
    ...afterItems,
  ];
  const composed: ComposedFortune = {
    body: layout.join('\n'),
    aiBody: truncated,
  };
  return composed;
};

// 줄 머리 이모지·굵게 표식·콜론 앞 공백이 흔들려도 라벨을 찾는다. 라벨 뒤 글이 비면 못 찾은 것으로 본다.
const scoreLabelPattern = (key: FortuneScoreKey): RegExp =>
  new RegExp(
    `^[^\\p{L}\\p{N}]*\\**\\s*${key}\\s*\\**\\s*[:：]\\s*\\**\\s*(.+)$`,
    'u',
  );

interface FoundScoreItem {
  key: FortuneScoreKey;
  index: number;
  text: string;
}

interface ScoreItems {
  texts: Record<FortuneScoreKey, string>;
  // 항목 줄이 아닌 나머지 — 빈 줄은 버리고, 항목 앞뒤로 나눠 자리를 지킨다.
  others: { before: string[]; after: string[] };
}

const findScoreItems = (lines: string[]): ScoreItems | null => {
  const found = FORTUNE_SCORE_KEYS.map((key) => findScoreItem({ lines, key }));
  const hasAll = found.every(
    ({ index, text }) => index >= 0 && text.length > 0,
  );
  if (!hasAll) {
    return null;
  }
  const itemIndexes = new Set(found.map(({ index }) => index));
  const firstItemIndex = Math.min(...itemIndexes);
  const others = lines
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line, index }) => !itemIndexes.has(index) && line.trim().length > 0,
    );
  const texts: Record<FortuneScoreKey, string> = {
    [FortuneScoreKey.총운]: textOf({ found, key: FortuneScoreKey.총운 }),
    [FortuneScoreKey.일공부]: textOf({ found, key: FortuneScoreKey.일공부 }),
    [FortuneScoreKey.사람관계]: textOf({
      found,
      key: FortuneScoreKey.사람관계,
    }),
    [FortuneScoreKey.돈]: textOf({ found, key: FortuneScoreKey.돈 }),
    [FortuneScoreKey.컨디션]: textOf({ found, key: FortuneScoreKey.컨디션 }),
  };
  const items: ScoreItems = {
    texts,
    others: {
      before: others
        .filter(({ index }) => index < firstItemIndex)
        .map(({ line }) => line),
      after: others
        .filter(({ index }) => index > firstItemIndex)
        .map(({ line }) => line),
    },
  };
  return items;
};

const findScoreItem = ({
  lines,
  key,
}: {
  lines: string[];
  key: FortuneScoreKey;
}): FoundScoreItem => {
  const pattern = scoreLabelPattern(key);
  const index = lines.findIndex((line) => pattern.test(line));
  const matched = index < 0 ? null : pattern.exec(lines[index]);
  const text = matched ? matched[1].trim() : '';
  const item: FoundScoreItem = { key, index, text };
  return item;
};

const textOf = ({
  found,
  key,
}: {
  found: FoundScoreItem[];
  key: FortuneScoreKey;
}): string => {
  const text = found.find((item) => item.key === key)?.text ?? '';
  return text;
};

// 주간 글의 "총운:" 같은 항목 라벨을 굵게 — 일일 운세와 같은 무게로 훑어보게. 줄 머리에 있을 때만.
const SCORE_LABEL_LINE_PATTERN = new RegExp(
  `^\\s*(${FORTUNE_SCORE_KEYS.join('|')})\\s*[:：]\\s*`,
);

const boldScoreLabel = (line: string): string =>
  line.replace(SCORE_LABEL_LINE_PATTERN, (_, label: string) => `*${label}:* `);

// 행운 포인트·오늘의 한 마디 라벨만 굵게 — 별점 항목과 같은 무게로 훑어보게.
const TAIL_LABEL_PATTERN = /^\s*(행운 포인트|오늘의 한 마디)\s*[:：]\s*/;

const boldTailLabel = (line: string): string =>
  line.replace(TAIL_LABEL_PATTERN, (_, label: string) => `*${label}:* `);

// 항목별 배치가 더하는 글자 수 — 라벨·별 줄, 블록 사이 빈 줄, 행운 아이템 줄과 앞뒤 개행.
const itemLayoutOverhead = (itemLine: string): number => {
  const labelLines = FORTUNE_SCORE_KEYS.reduce(
    (sum, key) => sum + `*${key}* ${starsOf(MAXIMUM_STARS)}\n`.length,
    0,
  );
  const gaps = FORTUNE_SCORE_KEYS.length * 2 + 4;
  const overhead = labelLines + gaps + itemLine.length;
  return overhead;
};

// 추가 메시지(특집·주간)의 AI 응답 구간 구분줄. 프롬프트와 파서가 같은 상수를 쓴다.
export const EXTRA_SECTION_SEPARATOR = '=====';

// 구간 수가 코드가 기대한 수와 같을 때만 나눈다 — 다르면 null(호출부가 재생성하거나 한 덩어리로 쓴다).
export const splitExtraSections = ({
  text,
  expected,
}: {
  text: string;
  expected: number;
}): string[] | null => {
  const sections = text
    .split('\n')
    .reduce<string[][]>(
      (groups, line) => {
        if (line.trim() === EXTRA_SECTION_SEPARATOR) {
          groups.push([]);
        } else {
          groups[groups.length - 1].push(line);
        }
        return groups;
      },
      [[]],
    )
    .map((lines) => {
      const section = lines.join('\n');
      const trimmed = section.trim();
      return trimmed;
    })
    .filter((section) => section.length > 0);
  const matches = sections.length === expected;
  return matches ? sections : null;
};

// 추가 메시지 본문 — 코드 줄(특집 줄·주간 별점 줄)은 예산을 먼저 확보하고, 남은 예산을 구간마다 나눠 AI 글을
// 줄 단위로 자른다(뒤 구간이 통째로 사라지지 않게). 별 제거는 코드 줄을 붙이기 전에 해서 주간 별점 줄이 지워지지 않게
// 한다. 일일의 별점 줄·행운 아이템 줄은 넣지 않는다. escape 는 호출부가 마지막에 한 번.
export const composeExtraBody = ({
  sections,
  specialLines,
  weeklyStarLine,
  maximum,
}: {
  sections: string[];
  specialLines: string[];
  weeklyStarLine?: string;
  maximum: number;
}): string => {
  const codeLines = [...specialLines];
  if (weeklyStarLine) {
    codeLines.push(weeklyStarLine);
  }
  // 라벨 굵게는 자르기 전에 — 표식 두 글자도 예산에 들어가야 상한을 넘지 않는다.
  const cleaned = sections.map((section) => {
    const boldLines = stripInventedMarks(section)
      .trim()
      .split('\n')
      .map(boldScoreLabel);
    const bolded = boldLines.join('\n');
    return bolded;
  });
  const assemble = (bodies: string[]): string => {
    if (bodies.length === codeLines.length) {
      const paired = codeLines.map(
        (line, index) => `${line}\n${bodies[index]}`,
      );
      const joined = paired.join('\n\n');
      return joined;
    }
    const assembled = `${codeLines.join('\n')}\n\n${bodies.join('\n\n')}`;
    return assembled;
  };
  const overhead = assemble(cleaned.map(() => '')).length;
  const budget = Math.max(0, Math.floor((maximum - overhead) / cleaned.length));
  const truncated = cleaned.map((body) => truncateByLines({ body, budget }));
  const assembled = assemble(truncated);
  return assembled;
};
