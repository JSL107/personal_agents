// 사주 해석에 쓰는 고정 표. 학파가 갈리는 곳은 국내 주류 쪽을 골랐다(설계: 2026-11-09 사주 1단계 spec).
// 순번 규약: 천간 甲=0…癸=9, 지지 子=0…亥=11, 오행 나무·불·흙·쇠·물=0…4.
import type { FiveElement } from './saju-analysis';

// 지지 속 숨은 천간과 월률분야 사령일수(여기→중기→정기, 합 30). 정기가 지지의 본기다.
export const HIDDEN_STEM_DAYS: Record<
  string,
  ReadonlyArray<readonly [string, number]>
> = {
  子: [
    ['壬', 10],
    ['癸', 20],
  ],
  丑: [
    ['癸', 9],
    ['辛', 3],
    ['己', 18],
  ],
  寅: [
    ['戊', 7],
    ['丙', 7],
    ['甲', 16],
  ],
  卯: [
    ['甲', 10],
    ['乙', 20],
  ],
  辰: [
    ['乙', 9],
    ['癸', 3],
    ['戊', 18],
  ],
  巳: [
    ['戊', 7],
    ['庚', 7],
    ['丙', 16],
  ],
  午: [
    ['丙', 10],
    ['己', 9],
    ['丁', 11],
  ],
  未: [
    ['丁', 9],
    ['乙', 3],
    ['己', 18],
  ],
  申: [
    ['戊', 7],
    ['壬', 7],
    ['庚', 16],
  ],
  酉: [
    ['庚', 10],
    ['辛', 20],
  ],
  戌: [
    ['辛', 9],
    ['丁', 3],
    ['戊', 18],
  ],
  亥: [
    ['戊', 7],
    ['甲', 7],
    ['壬', 16],
  ],
};

export const TWELVE_STAGES = [
  '장생',
  '목욕',
  '관대',
  '건록',
  '제왕',
  '쇠',
  '병',
  '사',
  '묘',
  '절',
  '태',
  '양',
] as const;
export type TwelveStage = (typeof TWELVE_STAGES)[number];

// 일간마다 장생을 맞는 지지. 음간은 역행, 戊는 丙·己는 丁을 따른다(화토동법).
export const TWELVE_STAGE_START: Record<string, string> = {
  甲: '亥',
  丙: '寅',
  戊: '寅',
  庚: '巳',
  壬: '申',
  乙: '午',
  丁: '酉',
  己: '酉',
  辛: '子',
  癸: '卯',
};

// 받는 사람에게는 단계 이름 대신 이 뜻이 전해진다(사실 문장은 용어를 싣지 않는다).
export const TWELVE_STAGE_MEANINGS: Record<TwelveStage, string> = {
  장생: '새싹이 돋듯 기운이 막 살아나는 때',
  목욕: '기운이 들뜨고 마음이 여기저기 끌리는 때',
  관대: '자신감이 붙어 앞으로 나서기 좋은 때',
  건록: '제 힘으로 일을 꾸려 가기 좋은 때',
  제왕: '기세가 가장 차오른 때',
  쇠: '기세가 한풀 꺾여 차분해지는 때',
  병: '기운이 처져 몸을 아껴야 하는 때',
  사: '움직임이 멈추고 생각이 깊어지는 때',
  묘: '기운을 안으로 갈무리하는 때',
  절: '힘을 빼고 쉬어 가는 때',
  태: '새 계획이 마음속에 싹트는 때',
  양: '다음 걸음을 위해 힘을 기르는 때',
};

export const STRONG_STAGES: ReadonlySet<TwelveStage> = new Set([
  '장생',
  '관대',
  '건록',
  '제왕',
]);
export const WEAK_STAGES: ReadonlySet<TwelveStage> = new Set([
  '병',
  '사',
  '묘',
  '절',
]);

export type FortuneCategory = '일·공부' | '사람 관계' | '돈' | '컨디션';
export type FortuneScoreKey = '총운' | FortuneCategory;
// 별점 줄과 AI 에 주는 "별점 결" 사실이 같은 순서로 항목을 늘어놓는다.
export const FORTUNE_SCORE_KEYS: readonly FortuneScoreKey[] = [
  '총운',
  '일·공부',
  '사람 관계',
  '돈',
  '컨디션',
];
// 12운성으로 본 오늘의 기세.
export type FortuneStrength = '강' | '보통' | '약';
type ScoreAdjustment = Partial<Record<FortuneCategory, number>>;

// 별점 가감표. 운영하며 값을 고칠 곳은 여기 하나다. 명리에 정해진 별점 공식은 없어 판단이 들어간 표다.
// 지지 충은 별점에서 빼고 글로만 조심시킨다 — 컨디션 감점 이유가 셋이라 ★2 가 사흘에 한 번꼴(32~35%)이었다.
export const SCORE_ADJUSTMENTS: {
  // 오늘 천간·지지의 십성 갈래(0 비겁·1 식상·2 재성·3 관성·4 인성)마다 한 번씩 더한다.
  tenGodGroups: readonly ScoreAdjustment[];
  stage: Record<FortuneStrength, ScoreAdjustment>;
  branchHarmony: ScoreAdjustment;
  voidDay: ScoreAdjustment;
  overallStage: Record<FortuneStrength, number>;
} = {
  tenGodGroups: [
    { 돈: -1, 컨디션: 1 },
    { '사람 관계': 1, 컨디션: -1 },
    { '일·공부': -1, 돈: 1 },
    { '일·공부': 1, '사람 관계': -1 },
    { '일·공부': 1, 컨디션: 1 },
  ],
  stage: { 강: { 컨디션: 1 }, 보통: {}, 약: { 컨디션: -1 } },
  branchHarmony: { '사람 관계': 1 },
  voidDay: { '일·공부': -1 },
  overallStage: { 강: 1, 보통: 0, 약: -1 },
};

// 오늘 천간 갈래 → 오늘 행운 기운 갈래(하루 단위 억부·통관). 관성은 행운으로 뽑지 않는다.
export const LUCKY_GROUP_BY_TODAY_GROUP = [1, 4, 0, 4, 2] as const;
export const LUCKY_REASONS = [
  '넘치는 힘을 밖으로 풀어 주는 기운',
  '빠진 힘을 채워 주는 기운',
  '감당할 힘을 보태 주는 기운',
  '압박을 도움으로 바꿔 이어 주는 기운',
  '받은 걸 움직여 쓰게 하는 기운',
] as const;

// 오행 대응표 — 색은 기존 표현(물=남색, 전통 정색은 흑), 숫자 하도, 맛 오미, 방향 오방.
export const ELEMENT_COLORS: Record<FiveElement, string> = {
  나무: '초록',
  불: '빨강',
  흙: '노랑',
  쇠: '흰색',
  물: '남색',
};
export const ELEMENT_NUMBERS = [
  [3, 8],
  [2, 7],
  [5, 10],
  [4, 9],
  [1, 6],
] as const;
export const ELEMENT_TASTES = [
  '신맛',
  '쓴맛',
  '단맛',
  '매운맛',
  '짠맛',
] as const;
export const ELEMENT_DIRECTIONS = [
  '동쪽',
  '남쪽',
  '한가운데 자리',
  '서쪽',
  '북쪽',
] as const;
// 맛마다 예시 음식. 순서가 날짜별 선택을 정하므로 바꾸면 같은 날의 음식이 달라진다.
export const ELEMENT_FOODS: readonly (readonly string[])[] = [
  ['레몬차', '오렌지', '요거트', '매실차', '키위'],
  ['아메리카노', '다크초콜릿', '녹차', '자몽', '쑥떡'],
  ['고구마', '꿀차', '단호박', '바나나', '대추차'],
  ['생강차', '김치볶음밥', '떡볶이', '양파링', '와사비 김'],
  ['미역국', '짭짤한 크래커', '된장국', '구운 김', '감자칩'],
];
