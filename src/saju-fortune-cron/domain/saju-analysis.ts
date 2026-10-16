// 사주 해석의 뼈대(오행 분포·십성·지지 충합)는 표를 찾아보는 계산이라 코드로 확정한다.
// LLM 에는 이 사실을 넘기고 쉬운 말로 풀어 쓰는 일만 맡긴다 — 일진을 코드로 정한 것과 같은 이유다.

const ELEMENTS = ['나무', '불', '흙', '쇠', '물'] as const;
export type FiveElement = (typeof ELEMENTS)[number];

const HEAVENLY_STEMS = '甲乙丙丁戊己庚辛壬癸';
const EARTHLY_BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const EARTHLY_BRANCHES_HANGUL = '자축인묘진사오미신유술해';
// 지지가 품은 대표 천간(본기). 지지의 오행·음양·십성은 이 천간으로 본다.
const BRANCH_MAIN_STEMS = '癸己甲乙戊丙丁己庚辛戊壬';
const PILLAR_LABELS = ['년주', '월주', '일주', '시주'];
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

interface StemInfo {
  element: FiveElement;
  isYang: boolean;
}

export interface BranchRelation {
  kind: BranchRelationKind;
  natalLabel: string;
  natalBranch: string;
}

export interface SajuDayAnalysis {
  dayMaster: StemInfo;
  elementCounts: Record<FiveElement, number>;
  todayStem: StemInfo & { tenGod: TenGod };
  todayBranch: StemInfo & { tenGod: TenGod };
  branchRelations: BranchRelation[];
}

const stemInfoOf = (stem: string): StemInfo => {
  const index = HEAVENLY_STEMS.indexOf(stem);
  return { element: ELEMENTS[Math.floor(index / 2)], isYang: index % 2 === 0 };
};

const branchInfoOf = (branch: string): StemInfo =>
  stemInfoOf(BRANCH_MAIN_STEMS[EARTHLY_BRANCHES.indexOf(branch)]);

// 일간에서 본 상대 기운. 오행 순서상 몇 칸 떨어졌는지(같음·내가 생함·내가 극함·나를 극함·나를 생함)로
// 갈래가 정해지고, 음양이 같으면 앞쪽(편)·다르면 뒤쪽(정)이다.
export const tenGodOf = (dayMaster: StemInfo, other: StemInfo): TenGod => {
  const distance =
    (ELEMENTS.indexOf(other.element) -
      ELEMENTS.indexOf(dayMaster.element) +
      ELEMENTS.length) %
    ELEMENTS.length;
  return TEN_GODS[distance][dayMaster.isYang === other.isYang ? 0 : 1];
};

const branchRelationOf = (
  todayBranch: string,
  natalBranch: string,
): BranchRelationKind | null => {
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

// natalPillars: 년·월·일(·시) 순 — 파서가 60갑자 형식을 이미 검사했다.
export const analyzeSajuDay = (
  natalPillars: string[],
  todayPillar: string,
): SajuDayAnalysis => {
  const dayMaster = stemInfoOf(natalPillars[2][0]);

  const elementCounts = Object.fromEntries(
    ELEMENTS.map((element) => [element, 0]),
  ) as Record<FiveElement, number>;
  for (const pillar of natalPillars) {
    elementCounts[stemInfoOf(pillar[0]).element]++;
    elementCounts[branchInfoOf(pillar[1]).element]++;
  }

  const todayStem = stemInfoOf(todayPillar[0]);
  const todayBranch = branchInfoOf(todayPillar[1]);
  const branchRelations = natalPillars.flatMap((pillar, index) => {
    const kind = branchRelationOf(todayPillar[1], pillar[1]);
    return kind
      ? [{ kind, natalLabel: PILLAR_LABELS[index], natalBranch: pillar[1] }]
      : [];
  });

  return {
    dayMaster,
    elementCounts,
    todayStem: { ...todayStem, tenGod: tenGodOf(dayMaster, todayStem) },
    todayBranch: { ...todayBranch, tenGod: tenGodOf(dayMaster, todayBranch) },
    branchRelations,
  };
};

const yinYangOf = ({ isYang }: StemInfo): string => (isYang ? '양' : '음');

// 프롬프트에 그대로 싣는 사실 목록. 모델이 다시 계산하지 않게 "확정값" 으로 준다.
export const formatSajuFacts = (analysis: SajuDayAnalysis): string[] => {
  const { dayMaster, elementCounts, todayStem, todayBranch } = analysis;
  const distribution = ELEMENTS.map(
    (element) => `${element} ${elementCounts[element]}`,
  ).join(' · ');
  const missing = ELEMENTS.filter((element) => elementCounts[element] === 0);
  const maximum = Math.max(...Object.values(elementCounts));
  const abundant = ELEMENTS.filter(
    (element) => elementCounts[element] === maximum,
  );

  const facts = [
    `- 타고난 중심 기운(일간): ${dayMaster.element}(${yinYangOf(dayMaster)})`,
    `- 타고난 오행 분포: ${distribution} — 가장 많은 기운: ${abundant.join('·')}${missing.length > 0 ? `, 없는 기운: ${missing.join('·')}` : ''}`,
    `- 오늘 천간의 기운: ${todayStem.element}(${yinYangOf(todayStem)}) → 받는 사람에게 ${TEN_GOD_MEANINGS[todayStem.tenGod]} [${todayStem.tenGod}]`,
    `- 오늘 지지의 기운: ${todayBranch.element}(${yinYangOf(todayBranch)}) → 받는 사람에게 ${TEN_GOD_MEANINGS[todayBranch.tenGod]} [${todayBranch.tenGod}]`,
  ];
  for (const element of new Set([todayStem.element, todayBranch.element])) {
    if (elementCounts[element] === 0) {
      facts.push(
        `- 오늘 들어오는 ${element} 기운은 타고나기를 없는 기운이다 — 부족한 것을 채워 주는 날`,
      );
    } else if (elementCounts[element] === maximum) {
      facts.push(
        `- 오늘 들어오는 ${element} 기운은 이미 가장 많은 기운이다 — 넘치지 않게 조절할 날`,
      );
    }
  }
  for (const relation of analysis.branchRelations) {
    facts.push(
      `- 오늘 지지와 타고난 ${relation.natalLabel} 지지(${EARTHLY_BRANCHES_HANGUL[EARTHLY_BRANCHES.indexOf(relation.natalBranch)]}): ${BRANCH_RELATION_MEANINGS[relation.kind]} [${relation.kind}]`,
    );
  }
  return facts;
};
