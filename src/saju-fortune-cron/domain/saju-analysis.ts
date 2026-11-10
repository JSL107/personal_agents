// 사주 해석의 뼈대(오행 분포·십성·지지 충합)는 표를 찾아보는 계산이라 코드로 확정한다.
// LLM 에는 이 사실을 넘기고 쉬운 말로 풀어 쓰는 일만 맡긴다 — 일진을 코드로 정한 것과 같은 이유다.

import { pillarToHangul } from './day-pillar';
import {
  ELEMENT_COLORS,
  ELEMENT_DIRECTIONS,
  ELEMENT_FOODS,
  ELEMENT_NUMBERS,
  ELEMENT_TASTES,
  FORTUNE_SCORE_KEYS,
  FortuneCategory,
  FortuneScoreKey,
  FortuneStrength,
  HIDDEN_STEM_DAYS,
  LUCKY_GROUP_BY_TODAY_GROUP,
  LUCKY_REASONS,
  SCORE_ADJUSTMENTS,
  STRONG_STAGES,
  TWELVE_STAGE_MEANINGS,
  TWELVE_STAGE_START,
  TWELVE_STAGES,
  TwelveStage,
  WEAK_STAGES,
} from './saju-tables';

export const ELEMENT_UNIT = 30;

const ELEMENTS = ['나무', '불', '흙', '쇠', '물'] as const;
export type FiveElement = (typeof ELEMENTS)[number];

const HEAVENLY_STEMS = '甲乙丙丁戊己庚辛壬癸';
const EARTHLY_BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const EARTHLY_BRANCHES_HANGUL = '자축인묘진사오미신유술해';
// 지지가 품은 대표 천간(본기). 지지의 오행·음양·십성은 이 천간으로 본다.
const BRANCH_MAIN_STEMS = '癸己甲乙戊丙丁己庚辛戊壬';
const PILLAR_LABELS = ['년주', '월주', '일주', '시주'];
// 기둥이 뜻하는 삶의 자리. 없으면 모델이 "타고난 일상의 자리" 처럼 모호하게 지어 풀어 쓴다.
const PILLAR_MEANINGS: Record<string, string> = {
  년주: '뿌리·집안',
  월주: '일터·사회생활',
  일주: '나 자신·가까운 관계',
  시주: '앞날·계획',
};
const CLASH_DISTANCE = 6;

const TEN_GODS = [
  ['비견', '겁재'],
  ['식신', '상관'],
  ['편재', '정재'],
  ['편관', '정관'],
  ['편인', '정인'],
] as const;
export type TenGod = (typeof TEN_GODS)[number][number];

// 받는 사람에게는 용어 대신 이 뜻이 전해져야 한다(프롬프트가 용어 사용을 막는다).
const TEN_GOD_MEANINGS: Record<TenGod, string> = {
  비견: '나와 같은 기운 — 자기 주장, 동료, 경쟁',
  겁재: '나와 같지만 결이 다른 기운 — 승부욕, 경쟁, 나눠 쓰기',
  식신: '내가 내보내는 기운 — 재주, 표현, 여유',
  상관: '내가 거침없이 내보내는 기운 — 말솜씨, 틀 깨기, 예민함',
  편재: '내가 움직여 얻는 기운 — 기회, 활동, 씀씀이',
  정재: '내가 차곡차곡 다루는 기운 — 꾸준한 수입, 관리, 성실',
  편관: '나를 세게 누르는 기운 — 압박, 도전, 결단',
  정관: '나를 바르게 잡아 주는 기운 — 규칙, 책임, 평판',
  편인: '나를 돕되 독특한 기운 — 직관, 아이디어, 혼자 생각',
  정인: '나를 따뜻하게 돕는 기운 — 배움, 도움, 안정',
};

const BRANCH_RELATION_MEANINGS = {
  충: '부딪힘 — 변화, 이동, 마음이 흔들림',
  합: '맞물림 — 끌림, 협력, 묶임',
} as const;
type BranchRelationKind = keyof typeof BRANCH_RELATION_MEANINGS;

const STEM_RELATION_MEANINGS = {
  합: '끌림 — 마음이 맞고 손잡기 좋음',
  충: '부딪힘 — 생각이 엇갈리기 쉬움',
} as const;
type StemRelationKind = keyof typeof STEM_RELATION_MEANINGS;
// 천간 순번 차 5(甲己·乙庚·丙辛·丁壬·戊癸)는 합, 6(甲庚·乙辛·丙壬·丁癸)은 충. 戊·己 는 충이 없다.
const STEM_HARMONY_DISTANCE = 5;
const STEM_CLASH_DISTANCE = 6;

// 삼합 무리는 지지 순번을 4로 나눈 나머지가 같다 — 0 申子辰 물, 1 巳酉丑 쇠, 2 寅午戌 불, 3 亥卯未 나무.
const HARMONY_GROUP_COUNT = 4;
const HARMONY_GROUP_ELEMENTS: readonly FiveElement[] = [
  '물',
  '쇠',
  '불',
  '나무',
];
// 무리마다 하나씩 있는 왕지. 반합은 두 글자 중 하나가 왕지일 때만 인정한다(보수적 기준).
const PEAK_BRANCHES = '子卯午酉';
const HARMONY_GROUP_MEANINGS = {
  삼합: (element: FiveElement): string =>
    `오늘 들어온 기운이 타고난 기운과 크게 모여 ${element} 기운을 이룬다 — 힘이 한쪽으로 쏠리는 날`,
  반합: (element: FiveElement): string =>
    `오늘 들어온 기운이 타고난 기운과 모여 ${element} 기운이 살아난다 — 힘이 한쪽으로 모이기 시작하는 날`,
} as const;

export interface StemRelation {
  kind: StemRelationKind;
  natalLabel: string;
  natalStem: string;
}

export interface HarmonyGroup {
  kind: keyof typeof HARMONY_GROUP_MEANINGS;
  element: FiveElement;
  natalLabels: string[];
}

interface StemInfo {
  element: FiveElement;
  isYang: boolean;
}

export interface BranchRelation {
  kind: BranchRelationKind;
  natalLabel: string;
  natalBranch: string;
}

type StemWithTenGod = StemInfo & { tenGod: TenGod };

// 그날의 년주·월주. 절기표가 필요해 application 의 yearMonthPillarsOf 가 계산해 넘긴다.
export interface YearMonthPillars {
  yearPillar: string;
  monthPillar: string;
}

// 올해·이번 달의 간지가 받는 사람에게 어떤 기운인지 — 오늘 하루를 더 긴 흐름 안에 놓아 준다.
export interface PeriodFlow {
  // 예: '올해(병오년)'
  title: string;
  stem: StemWithTenGod;
  branch: StemWithTenGod;
}

export interface SajuDayAnalysis {
  dayMaster: StemInfo;
  // 단위 1/30 — 천간 하나 = 30, 지지 하나 = 지장간 사령일수(합 30). 정수라 동률·0 판정이 정확하다.
  elementUnits: Record<FiveElement, number>;
  todayStem: StemWithTenGod;
  todayBranch: StemWithTenGod;
  // 오늘 천간 순번(甲=0). 날마다 한 칸씩 돌아 행운 숫자·음식을 날마다 다르게 고르는 데 쓴다.
  todayStemIndex: number;
  branchRelations: BranchRelation[];
  periodFlows: PeriodFlow[];
  twelveStage: { stage: TwelveStage; strength: FortuneStrength };
  // 오늘 일지가 타고난 일주의 공망 지지인가.
  isVoidDay: boolean;
  stemRelations: StemRelation[];
  harmonyGroup?: HarmonyGroup;
  // 지지끼리 맞물림(육합·삼합·반합)이 하나라도 있는가. 천간 끌림은 넣지 않는다 — 별점·해공은 지지로만 본다.
  hasBranchHarmony: boolean;
  scores: Record<FortuneScoreKey, number>;
  lucky: LuckyInfo;
}

// 오늘의 행운 기운 — 오늘 천간이 일간에게 어떤 갈래인지로 정한다(하루 단위 억부·통관).
// 원국의 부족한 기운으로 정하면 사람마다 거의 매일 같은 답이 나와 그날의 행운이 되지 못했다.
export interface LuckyInfo {
  element: FiveElement;
  reason: string;
  color: string;
  number: number;
  taste: string;
  food: string;
  direction: string;
}

const luckyOf = ({
  dayMaster,
  todayStem,
  todayStemIndex,
}: {
  dayMaster: StemInfo;
  todayStem: StemInfo;
  todayStemIndex: number;
}): LuckyInfo => {
  const todayGroup = tenGodGroupOf({ dayMaster, other: todayStem });
  // 오행은 나무→불→흙→쇠→물로 도는 고리다. 표의 값은 일간 자리에서 몇 칸 갈지(0 같은 기운·1 내가 생함…)다.
  const dayMasterIndex = ELEMENTS.indexOf(dayMaster.element);
  const steps = LUCKY_GROUP_BY_TODAY_GROUP[todayGroup];
  const index = (dayMasterIndex + steps) % ELEMENTS.length;
  const element = ELEMENTS[index];
  const foods = ELEMENT_FOODS[index];
  // 숫자는 날마다, 음식은 이틀마다 바뀐다 — 같은 주기로 묶여 돌지 않게.
  const number = ELEMENT_NUMBERS[index][todayStemIndex % 2];
  const food = foods[Math.floor(todayStemIndex / 2) % foods.length];
  return {
    element,
    reason: LUCKY_REASONS[todayGroup],
    color: ELEMENT_COLORS[element],
    number,
    taste: ELEMENT_TASTES[index],
    food,
    direction: ELEMENT_DIRECTIONS[index],
  };
};

export interface ScoreInput {
  // 십성 갈래 0 비겁·1 식상·2 재성·3 관성·4 인성.
  todayStemGroup: number;
  todayBranchGroup: number;
  strength: FortuneStrength;
  hasBranchHarmony: boolean;
  isVoidDay: boolean;
}

const BASE_SCORE = 3;
const MINIMUM_SCORE = 2;
const MAXIMUM_SCORE = 5;
const SCORE_CATEGORIES: readonly FortuneCategory[] = [
  '일·공부',
  '사람 관계',
  '돈',
  '컨디션',
];
// AI 에는 별 숫자 대신 이 결만 준다 — 숫자를 주면 본문에 옮겨 적는다.
const SCORE_TONES: Record<number, string> = {
  2: '조심할 날',
  3: '무난한 날',
  4: '좋은 날',
  5: '좋은 날',
};

const clampScore = (value: number): number =>
  Math.min(MAXIMUM_SCORE, Math.max(MINIMUM_SCORE, value));

// 다섯 항목 별점. 가감 값은 SCORE_ADJUSTMENTS 표 하나에서만 읽는다.
export const scoreFortune = (
  input: ScoreInput,
): Record<FortuneScoreKey, number> => {
  const raw: Record<FortuneCategory, number> = {
    '일·공부': BASE_SCORE,
    '사람 관계': BASE_SCORE,
    돈: BASE_SCORE,
    컨디션: BASE_SCORE,
  };
  const apply = (
    adjustment: Partial<Record<FortuneCategory, number>>,
  ): void => {
    for (const category of SCORE_CATEGORIES) {
      raw[category] += adjustment[category] ?? 0;
    }
  };
  apply(SCORE_ADJUSTMENTS.tenGodGroups[input.todayStemGroup]);
  apply(SCORE_ADJUSTMENTS.tenGodGroups[input.todayBranchGroup]);
  apply(SCORE_ADJUSTMENTS.stage[input.strength]);
  if (input.hasBranchHarmony) {
    apply(SCORE_ADJUSTMENTS.branchHarmony);
  }
  // 공망이어도 지지가 맞물리면 풀린다(해공).
  if (input.isVoidDay && !input.hasBranchHarmony) {
    apply(SCORE_ADJUSTMENTS.voidDay);
  }

  const rawSum = SCORE_CATEGORIES.reduce(
    (sum, category) => sum + raw[category],
    0,
  );
  // 네 원점수 평균을 반올림(.5 는 올림)하고 기세를 더한다 — 기세가 하루 전체를 좌우한다는 판단.
  const average = Math.floor(
    (rawSum + SCORE_CATEGORIES.length / 2) / SCORE_CATEGORIES.length,
  );
  const overall = average + SCORE_ADJUSTMENTS.overallStage[input.strength];
  const scores: Record<FortuneScoreKey, number> = {
    총운: clampScore(overall),
    '일·공부': clampScore(raw['일·공부']),
    '사람 관계': clampScore(raw['사람 관계']),
    돈: clampScore(raw.돈),
    컨디션: clampScore(raw.컨디션),
  };
  return scores;
};

const stemInfoOf = (stem: string): StemInfo => {
  const index = HEAVENLY_STEMS.indexOf(stem);
  return { element: ELEMENTS[Math.floor(index / 2)], isYang: index % 2 === 0 };
};

const branchInfoOf = (branch: string): StemInfo =>
  stemInfoOf(BRANCH_MAIN_STEMS[EARTHLY_BRANCHES.indexOf(branch)]);

// 일간에서 본 상대 기운. 오행 순서상 몇 칸 떨어졌는지(같음·내가 생함·내가 극함·나를 극함·나를 생함)로
// 갈래가 정해지고, 음양이 같으면 앞쪽(편)·다르면 뒤쪽(정)이다.
// 그 갈래 번호(0 비겁·1 식상·2 재성·3 관성·4 인성)가 별점·행운 표의 행 번호다.
const tenGodGroupOf = ({
  dayMaster,
  other,
}: {
  dayMaster: StemInfo;
  other: StemInfo;
}): number => {
  const steps =
    ELEMENTS.indexOf(other.element) - ELEMENTS.indexOf(dayMaster.element);
  const group = (steps + ELEMENTS.length) % ELEMENTS.length;
  return group;
};

export const tenGodOf = ({
  dayMaster,
  other,
}: {
  dayMaster: StemInfo;
  other: StemInfo;
}): TenGod => {
  const group = tenGodGroupOf({ dayMaster, other });
  const polarity = dayMaster.isYang === other.isYang ? 0 : 1;
  return TEN_GODS[group][polarity];
};

// 일간이 그 지지에서 갖는 기세. 양간은 장생 지지부터 순행, 음간은 역행한다.
export const twelveStageOf = ({
  dayStem,
  branch,
}: {
  dayStem: string;
  branch: string;
}): TwelveStage => {
  const start = EARTHLY_BRANCHES.indexOf(TWELVE_STAGE_START[dayStem]);
  const target = EARTHLY_BRANCHES.indexOf(branch);
  const steps = stemInfoOf(dayStem).isYang ? target - start : start - target;
  const index = (steps + EARTHLY_BRANCHES.length) % EARTHLY_BRANCHES.length;
  return TWELVE_STAGES[index];
};

// 일주가 속한 순(甲으로 시작하는 10일)에서 짝을 못 얻은 두 지지. 한 순 안에서는 천간·지지가 함께
// 한 칸씩 가므로 (지지 − 천간) 이 순마다 일정하고, 그 순의 첫 빈 지지가 그 값 + 10 이다.
export const voidBranchesOf = (dayPillar: string): [string, string] => {
  const first =
    (EARTHLY_BRANCHES.indexOf(dayPillar[1]) -
      HEAVENLY_STEMS.indexOf(dayPillar[0]) +
      HEAVENLY_STEMS.length) %
    EARTHLY_BRANCHES.length;
  const second = (first + 1) % EARTHLY_BRANCHES.length;
  return [EARTHLY_BRANCHES[first], EARTHLY_BRANCHES[second]];
};

export const stemRelationOf = ({
  todayStem,
  natalStem,
}: {
  todayStem: string;
  natalStem: string;
}): StemRelationKind | null => {
  const distance = Math.abs(
    HEAVENLY_STEMS.indexOf(todayStem) - HEAVENLY_STEMS.indexOf(natalStem),
  );
  if (distance === STEM_HARMONY_DISTANCE) {
    return '합';
  }
  if (distance === STEM_CLASH_DISTANCE) {
    return '충';
  }
  return null;
};

// 오늘 일지가 타고난 지지와 무리를 이루는가. 같은 글자는 빼고, 원국에 이미 완성된 무리는 새로 생기는 게 없다.
const harmonyGroupOf = ({
  natalPillars,
  todayBranch,
}: {
  natalPillars: string[];
  todayBranch: string;
}): HarmonyGroup | undefined => {
  const today = EARTHLY_BRANCHES.indexOf(todayBranch);
  const group = today % HARMONY_GROUP_COUNT;
  const members = natalPillars
    .map((pillar, index) => ({
      label: PILLAR_LABELS[index],
      branch: EARTHLY_BRANCHES.indexOf(pillar[1]),
    }))
    .filter(({ branch }) => branch % HARMONY_GROUP_COUNT === group);
  const natalLetters = new Set(members.map(({ branch }) => branch));
  // 무리 하나는 세 글자다 — 셋 다 원국에 있으면 오늘 들어와도 새로 모이는 게 없다.
  if (natalLetters.size === 3) {
    return undefined;
  }
  const element = HARMONY_GROUP_ELEMENTS[group];
  const others = members.filter(({ branch }) => branch !== today);
  const otherLetters = new Set(others.map(({ branch }) => branch));
  // 오늘 일지가 원국에 없는 글자이고, 원국이 나머지 두 글자를 갖고 있으면 오늘 무리가 완성된다.
  const completesGroup = !natalLetters.has(today) && otherLetters.size === 2;
  if (completesGroup) {
    const natalLabels = others.map(({ label }) => label);
    return { kind: '삼합', element, natalLabels };
  }
  const isPeak = (branch: number): boolean =>
    PEAK_BRANCHES.includes(EARTHLY_BRANCHES[branch]);
  const partners = others.filter(
    ({ branch }) => isPeak(today) || isPeak(branch),
  );
  if (partners.length === 0) {
    return undefined;
  }
  const natalLabels = partners.map(({ label }) => label);
  return { kind: '반합', element, natalLabels };
};

const strengthOf = (stage: TwelveStage): FortuneStrength => {
  if (STRONG_STAGES.has(stage)) {
    return '강';
  }
  return WEAK_STAGES.has(stage) ? '약' : '보통';
};

const branchRelationOf = ({
  todayBranch,
  natalBranch,
}: {
  todayBranch: string;
  natalBranch: string;
}): BranchRelationKind | null => {
  const today = EARTHLY_BRANCHES.indexOf(todayBranch);
  const natal = EARTHLY_BRANCHES.indexOf(natalBranch);
  if (Math.abs(today - natal) === CLASH_DISTANCE) {
    return '충';
  }
  // 육합(子丑·寅亥·卯戌·辰酉·巳申·午未)은 두 순번의 합이 12로 나눠 1 남는 짝이다.
  if ((today + natal) % EARTHLY_BRANCHES.length === 1) {
    return '합';
  }
  return null;
};

export interface AnalyzeSajuDayInput {
  natalPillars: string[];
  todayPillar: string;
  yearMonthPillars?: YearMonthPillars;
}

// natalPillars: 년·월·일(·시) 순 — 파서가 60갑자 형식을 이미 검사했다.
// period 를 빼면 올해·이번 달 흐름 사실이 빠진다 — 날짜 없이 기둥만 보는 단위 테스트용이다.
export const analyzeSajuDay = ({
  natalPillars,
  todayPillar,
  yearMonthPillars: period,
}: AnalyzeSajuDayInput): SajuDayAnalysis => {
  const dayMaster = stemInfoOf(natalPillars[2][0]);

  const elementUnits: Record<FiveElement, number> = {
    나무: 0,
    불: 0,
    흙: 0,
    쇠: 0,
    물: 0,
  };
  for (const pillar of natalPillars) {
    elementUnits[stemInfoOf(pillar[0]).element] += ELEMENT_UNIT;
    for (const [hiddenStem, days] of HIDDEN_STEM_DAYS[pillar[1]]) {
      elementUnits[stemInfoOf(hiddenStem).element] += days;
    }
  }

  const todayStem = stemInfoOf(todayPillar[0]);
  const todayBranch = branchInfoOf(todayPillar[1]);
  const branchRelations = natalPillars.flatMap((pillar, index) => {
    const kind = branchRelationOf({
      todayBranch: todayPillar[1],
      natalBranch: pillar[1],
    });
    if (!kind) {
      return [];
    }
    return [{ kind, natalLabel: PILLAR_LABELS[index], natalBranch: pillar[1] }];
  });

  const withTenGod = (info: StemInfo): StemWithTenGod => ({
    ...info,
    tenGod: tenGodOf({ dayMaster, other: info }),
  });
  const flowOf = ({
    label,
    unit,
    pillar,
  }: {
    label: string;
    unit: string;
    pillar: string;
  }): PeriodFlow => ({
    title: `${label}(${pillarToHangul(pillar)}${unit})`,
    stem: withTenGod(stemInfoOf(pillar[0])),
    branch: withTenGod(branchInfoOf(pillar[1])),
  });
  const periodFlows: PeriodFlow[] = [];
  if (period) {
    periodFlows.push(
      flowOf({ label: '올해', unit: '년', pillar: period.yearPillar }),
      flowOf({ label: '이번 달', unit: '월', pillar: period.monthPillar }),
    );
  }

  const stage = twelveStageOf({
    dayStem: natalPillars[2][0],
    branch: todayPillar[1],
  });
  const stemRelations = natalPillars.flatMap((pillar, index) => {
    const kind = stemRelationOf({
      todayStem: todayPillar[0],
      natalStem: pillar[0],
    });
    if (!kind) {
      return [];
    }
    return [{ kind, natalLabel: PILLAR_LABELS[index], natalStem: pillar[0] }];
  });
  const harmonyGroup = harmonyGroupOf({
    natalPillars,
    todayBranch: todayPillar[1],
  });
  const hasBranchHarmony =
    harmonyGroup !== undefined ||
    branchRelations.some(({ kind }) => kind === '합');
  const strength = strengthOf(stage);
  const isVoidDay = voidBranchesOf(natalPillars[2]).includes(todayPillar[1]);

  return {
    dayMaster,
    elementUnits,
    todayStem: withTenGod(todayStem),
    todayBranch: withTenGod(todayBranch),
    todayStemIndex: HEAVENLY_STEMS.indexOf(todayPillar[0]),
    branchRelations,
    periodFlows,
    twelveStage: { stage, strength },
    isVoidDay,
    stemRelations,
    ...(harmonyGroup ? { harmonyGroup } : {}),
    hasBranchHarmony,
    scores: scoreFortune({
      todayStemGroup: tenGodGroupOf({ dayMaster, other: todayStem }),
      todayBranchGroup: tenGodGroupOf({ dayMaster, other: todayBranch }),
      strength,
      hasBranchHarmony,
      isVoidDay,
    }),
    lucky: luckyOf({
      dayMaster,
      todayStem,
      todayStemIndex: HEAVENLY_STEMS.indexOf(todayPillar[0]),
    }),
  };
};

const yinYangOf = ({ isYang }: StemInfo): string => (isYang ? '양' : '음');

// 프롬프트에 그대로 싣는 사실 목록. 모델이 다시 계산하지 않게 "확정값" 으로 준다.
// 십성·충합 용어는 싣지 않고 뜻풀이만 싣는다 — 모델이 본 용어는 본문으로 새어 나온다.
export const formatSajuFacts = (analysis: SajuDayAnalysis): string[] => {
  const { dayMaster, elementUnits, todayStem, todayBranch } = analysis;
  // 표시는 1/30 을 소수 첫째 자리로. 표시가 같아도 판정(가장 많은·없는 기운)은 정수로 한다.
  const distribution = ELEMENTS.map(
    (element) =>
      `${element} ${(elementUnits[element] / ELEMENT_UNIT).toFixed(1)}`,
  ).join(' · ');
  const missing = ELEMENTS.filter((element) => elementUnits[element] === 0);
  const maximum = Math.max(...Object.values(elementUnits));
  const abundant = ELEMENTS.filter(
    (element) => elementUnits[element] === maximum,
  );

  const missingNote =
    missing.length > 0 ? `, 없는 기운: ${missing.join('·')}` : '';
  const facts = [
    `- 타고난 중심 기운(일간): ${dayMaster.element}(${yinYangOf(dayMaster)})`,
    `- 타고난 오행 분포: ${distribution} — 가장 많은 기운: ${abundant.join('·')}${missingNote}`,
    `- 오늘 천간의 기운: ${todayStem.element}(${yinYangOf(todayStem)}) → 받는 사람에게 ${TEN_GOD_MEANINGS[todayStem.tenGod]}`,
    `- 오늘 지지의 기운: ${todayBranch.element}(${yinYangOf(todayBranch)}) → 받는 사람에게 ${TEN_GOD_MEANINGS[todayBranch.tenGod]}`,
    ...analysis.periodFlows.map(
      ({ title, stem, branch }) =>
        `- ${title}의 흐름: 천간 ${stem.element}(${yinYangOf(stem)}) → ${TEN_GOD_MEANINGS[stem.tenGod]} / 지지 ${branch.element}(${yinYangOf(branch)}) → ${TEN_GOD_MEANINGS[branch.tenGod]}`,
    ),
  ];
  for (const element of new Set([todayStem.element, todayBranch.element])) {
    if (elementUnits[element] === 0) {
      facts.push(
        `- 오늘 들어오는 ${element} 기운은 타고나기를 없는 기운이다 — 부족한 것을 채워 주는 날`,
      );
    } else if (elementUnits[element] === maximum) {
      facts.push(
        `- 오늘 들어오는 ${element} 기운은 이미 가장 많은 기운이다 — 넘치지 않게 조절할 날`,
      );
    }
  }
  for (const relation of analysis.branchRelations) {
    facts.push(
      `- 오늘 지지와 타고난 ${relation.natalLabel} 지지(${EARTHLY_BRANCHES_HANGUL[EARTHLY_BRANCHES.indexOf(relation.natalBranch)]}, ${PILLAR_MEANINGS[relation.natalLabel]}의 자리): ${BRANCH_RELATION_MEANINGS[relation.kind]}`,
    );
  }
  facts.push(
    `- 오늘의 기세: ${TWELVE_STAGE_MEANINGS[analysis.twelveStage.stage]}`,
  );
  // 별점과 같은 해공 기준 — 지지가 맞물리면 공망이 풀려 권고하지 않는다.
  if (analysis.isVoidDay && !analysis.hasBranchHarmony) {
    facts.push('- 오늘은 새로 벌이기보다 정리·마무리하기 좋은 날');
  }
  for (const relation of analysis.stemRelations) {
    facts.push(
      `- 오늘 천간과 타고난 ${relation.natalLabel} 천간(${PILLAR_MEANINGS[relation.natalLabel]}의 자리): ${STEM_RELATION_MEANINGS[relation.kind]}`,
    );
  }
  if (analysis.harmonyGroup) {
    const { kind, element } = analysis.harmonyGroup;
    facts.push(`- ${HARMONY_GROUP_MEANINGS[kind](element)}`);
  }
  const tones = FORTUNE_SCORE_KEYS.map(
    (key) => `${key} ${SCORE_TONES[analysis.scores[key]]}`,
  ).join(' · ');
  facts.push(`- 별점 결(코드가 정함): ${tones}`);
  // 색·숫자는 싣지 않는다 — AI 가 옮겨 적으면 가드에 걸린다. 아이템 줄은 코드가 그린다.
  facts.push(
    `- 오늘의 행운 기운: ${analysis.lucky.element} — ${analysis.lucky.reason}`,
  );
  return facts;
};
