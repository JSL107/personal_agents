import { analyzeSajuDay, formatSajuFacts, tenGodOf } from './saju-analysis';

// 만세력 화면의 십성 칸과 대조한 표본 두 개(년·월·일·시주).
const SAMPLE_METAL = ['丙子', '甲午', '庚辰', '庚辰'];
const SAMPLE_EARTH = ['丙子', '辛丑', '己酉', '己巳'];

// 일간을 뺀 7칸 — [년간, 년지, 월간, 월지, 일지, 시간, 시지].
const tenGodsOfChart = (natalPillars: string[]): string[] => {
  const [year, month, day, hour] = natalPillars;
  return [year[0], year[1], month[0], month[1], day[1], hour[0], hour[1]].map(
    (character) => {
      // 오늘 자리에 그 글자가 들어온 것으로 보면 같은 계산이다.
      const pillar = HEAVENLY_STEMS.includes(character)
        ? `${character}子`
        : `甲${character}`;
      const { todayStem, todayBranch } = analyzeSajuDay(natalPillars, pillar);
      return HEAVENLY_STEMS.includes(character)
        ? todayStem.tenGod
        : todayBranch.tenGod;
    },
  );
};
const HEAVENLY_STEMS = '甲乙丙丁戊己庚辛壬癸';

describe('analyzeSajuDay', () => {
  it('십성이 만세력 화면과 같다 — 쇠(양) 일간', () => {
    expect(tenGodsOfChart(SAMPLE_METAL)).toEqual([
      '편관',
      '상관',
      '편재',
      '정관',
      '편인',
      '비견',
      '편인',
    ]);
  });

  it('십성이 만세력 화면과 같다 — 흙(음) 일간', () => {
    expect(tenGodsOfChart(SAMPLE_EARTH)).toEqual([
      '정인',
      '편재',
      '식신',
      '비견',
      '식신',
      '비견',
      '정인',
    ]);
  });

  it('오행 분포는 천간 4개 + 지지 본기 4개를 센다', () => {
    expect(analyzeSajuDay(SAMPLE_METAL, '癸亥').elementCounts).toEqual({
      나무: 1,
      불: 2,
      흙: 2,
      쇠: 2,
      물: 1,
    });
    expect(analyzeSajuDay(SAMPLE_EARTH, '癸亥').elementCounts).toEqual({
      나무: 0,
      불: 2,
      흙: 3,
      쇠: 2,
      물: 1,
    });
  });

  it('오늘 지지와 타고난 지지의 충·합을 찾는다', () => {
    // 亥 ↔ 巳 충 (시주)
    expect(analyzeSajuDay(SAMPLE_EARTH, '癸亥').branchRelations).toEqual([
      { kind: '충', natalLabel: '시주', natalBranch: '巳' },
    ]);
    // 申 ↔ 巳 합 (시주), 申 ↔ 子·丑·酉 은 관계 없음
    expect(analyzeSajuDay(SAMPLE_EARTH, '甲申').branchRelations).toEqual([
      { kind: '합', natalLabel: '시주', natalBranch: '巳' },
    ]);
    // 午 ↔ 子 충 (년주), 午 ↔ 午 는 같은 글자라 관계 아님
    expect(analyzeSajuDay(SAMPLE_METAL, '甲午').branchRelations).toEqual([
      { kind: '충', natalLabel: '년주', natalBranch: '子' },
    ]);
  });

  it('시주가 없는 3기둥도 계산한다', () => {
    const analysis = analyzeSajuDay(SAMPLE_EARTH.slice(0, 3), '癸亥');
    expect(Object.values(analysis.elementCounts).reduce((a, b) => a + b)).toBe(
      6,
    );
    expect(analysis.branchRelations).toEqual([]);
  });
});

describe('tenGodOf', () => {
  it('오행 순환 다섯 갈래와 음양을 모두 가른다', () => {
    const wood = { element: '나무' as const, isYang: true };
    expect(tenGodOf(wood, { element: '나무', isYang: false })).toBe('겁재');
    expect(tenGodOf(wood, { element: '불', isYang: true })).toBe('식신');
    expect(tenGodOf(wood, { element: '흙', isYang: false })).toBe('정재');
    expect(tenGodOf(wood, { element: '쇠', isYang: true })).toBe('편관');
    expect(tenGodOf(wood, { element: '물', isYang: false })).toBe('정인');
  });
});

describe('formatSajuFacts', () => {
  it('없는 기운이 오늘 들어오면 채워 주는 날이라고 적고, 충을 적는다', () => {
    const facts = formatSajuFacts(analyzeSajuDay(SAMPLE_EARTH, '甲寅'));
    expect(facts).toContainEqual(expect.stringContaining('없는 기운: 나무'));
    expect(facts).toContainEqual(
      expect.stringContaining('나무 기운은 타고나기를 없는 기운이다'),
    );
    expect(facts.join('\n')).not.toContain('undefined');
    // 사실 문장에는 한자가 없다(대괄호 안 용어는 한글).
    expect(facts.join('\n')).not.toMatch(/[\u4E00-\u9FFF]/);
  });

  it('충·합이 있으면 어느 기둥의 어떤 지지와인지 한글 뜻풀이로 적고, 용어는 싣지 않는다', () => {
    const clash = formatSajuFacts(analyzeSajuDay(SAMPLE_EARTH, '癸亥'));
    expect(clash).toContain(
      '- 오늘 지지와 타고난 시주 지지(사, 앞날·계획의 자리): 부딪힘 — 변화, 이동, 마음이 흔들림',
    );
    // 2026-10-20 실제 발송분에서 "타고난 일상의 자리" 로 모호하게 나왔던 일주 충.
    expect(formatSajuFacts(analyzeSajuDay(SAMPLE_EARTH, '丁卯'))).toContain(
      '- 오늘 지지와 타고난 일주 지지(유, 나 자신·가까운 관계의 자리): 부딪힘 — 변화, 이동, 마음이 흔들림',
    );
    const harmony = formatSajuFacts(analyzeSajuDay(SAMPLE_EARTH, '甲子'));
    expect(harmony).toContain(
      '- 오늘 지지와 타고난 월주 지지(축, 일터·사회생활의 자리): 맞물림 — 끌림, 협력, 묶임',
    );
    const allFacts = [...clash, ...harmony].join('\n');
    expect(allFacts).not.toMatch(
      /편재|정재|식신|상관|정관|편관|비견|겁재|정인|편인|충|합/,
    );
  });

  it('가장 많은 기운이 오늘 또 들어오면 조절할 날이라고 적는다', () => {
    const facts = formatSajuFacts(analyzeSajuDay(SAMPLE_EARTH, '戊辰'));
    expect(facts).toContainEqual(
      expect.stringContaining('흙 기운은 이미 가장 많은 기운이다'),
    );
  });
});
