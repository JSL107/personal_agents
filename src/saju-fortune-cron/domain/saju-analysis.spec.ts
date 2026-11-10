import {
  analyzeSajuDay,
  formatSajuFacts,
  scoreFortune,
  stemRelationOf,
  tenGodOf,
  twelveStageOf,
  voidBranchesOf,
} from './saju-analysis';

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
      const { todayStem, todayBranch } = analyzeSajuDay({
        natalPillars,
        todayPillar: pillar,
      });
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

  it('오행 분포는 천간 30 + 지지의 지장간 사령일수로 센다', () => {
    // 午 = 丙10 己9 丁11, 辰 = 乙9 癸3 戊18.
    expect(
      analyzeSajuDay({ natalPillars: SAMPLE_METAL, todayPillar: '癸亥' })
        .elementUnits,
    ).toEqual({
      나무: 48,
      불: 51,
      흙: 45,
      쇠: 60,
      물: 36,
    });
    expect(
      analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '癸亥' })
        .elementUnits,
    ).toEqual({
      나무: 0,
      불: 46,
      흙: 85,
      쇠: 70,
      물: 39,
    });
  });

  it('오늘 지지와 타고난 지지의 충·합을 찾는다', () => {
    // 亥 ↔ 巳 충 (시주)
    expect(
      analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '癸亥' })
        .branchRelations,
    ).toEqual([{ kind: '충', natalLabel: '시주', natalBranch: '巳' }]);
    // 申 ↔ 巳 합 (시주), 申 ↔ 子·丑·酉 은 관계 없음
    expect(
      analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '甲申' })
        .branchRelations,
    ).toEqual([{ kind: '합', natalLabel: '시주', natalBranch: '巳' }]);
    // 午 ↔ 子 충 (년주), 午 ↔ 午 는 같은 글자라 관계 아님
    expect(
      analyzeSajuDay({ natalPillars: SAMPLE_METAL, todayPillar: '甲午' })
        .branchRelations,
    ).toEqual([{ kind: '충', natalLabel: '년주', natalBranch: '子' }]);
  });

  it('시주가 없는 3기둥도 계산한다', () => {
    const analysis = analyzeSajuDay({
      natalPillars: SAMPLE_EARTH.slice(0, 3),
      todayPillar: '癸亥',
    });
    expect(Object.values(analysis.elementUnits).reduce((a, b) => a + b)).toBe(
      6 * 30,
    );
    expect(analysis.branchRelations).toEqual([]);
  });
});

describe('tenGodOf', () => {
  it('오행 순환 다섯 갈래와 음양을 모두 가른다', () => {
    const wood = { element: '나무' as const, isYang: true };
    expect(
      tenGodOf({ dayMaster: wood, other: { element: '나무', isYang: false } }),
    ).toBe('겁재');
    expect(
      tenGodOf({ dayMaster: wood, other: { element: '불', isYang: true } }),
    ).toBe('식신');
    expect(
      tenGodOf({ dayMaster: wood, other: { element: '흙', isYang: false } }),
    ).toBe('정재');
    expect(
      tenGodOf({ dayMaster: wood, other: { element: '쇠', isYang: true } }),
    ).toBe('편관');
    expect(
      tenGodOf({ dayMaster: wood, other: { element: '물', isYang: false } }),
    ).toBe('정인');
  });
});

describe('formatSajuFacts', () => {
  it('없는 기운이 오늘 들어오면 채워 주는 날이라고 적고, 충을 적는다', () => {
    const facts = formatSajuFacts(
      analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '甲寅' }),
    );
    expect(facts).toContainEqual(expect.stringContaining('없는 기운: 나무'));
    expect(facts).toContainEqual(
      expect.stringContaining('나무 기운은 타고나기를 없는 기운이다'),
    );
    expect(facts.join('\n')).not.toContain('undefined');
    // 사실 문장에는 한자가 없다(대괄호 안 용어는 한글).
    expect(facts.join('\n')).not.toMatch(/[\u4E00-\u9FFF]/);
  });

  it('공망이어도 지지가 맞물리면(해공) 정리·마무리 권고를 싣지 않는다', () => {
    // 일주 己酉 의 공망은 寅·卯. 오늘 甲寅 은 공망이지만 년주 亥 와 맞물린다.
    const analysis = analyzeSajuDay({
      natalPillars: ['乙亥', '辛丑', '己酉'],
      todayPillar: '甲寅',
    });
    expect(analysis.isVoidDay).toBe(true);
    expect(analysis.hasBranchHarmony).toBe(true);
    expect(formatSajuFacts(analysis).join('\n')).not.toContain('정리·마무리');
  });

  it('충·합이 있으면 어느 기둥의 어떤 지지와인지 한글 뜻풀이로 적고, 용어는 싣지 않는다', () => {
    const clash = formatSajuFacts(
      analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '癸亥' }),
    );
    expect(clash).toContain(
      '- 오늘 지지와 타고난 시주 지지(사, 앞날·계획의 자리): 부딪힘 — 변화, 이동, 마음이 흔들림',
    );
    // 2026-10-20 실제 발송분에서 "타고난 일상의 자리" 로 모호하게 나왔던 일주 충.
    expect(
      formatSajuFacts(
        analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '丁卯' }),
      ),
    ).toContain(
      '- 오늘 지지와 타고난 일주 지지(유, 나 자신·가까운 관계의 자리): 부딪힘 — 변화, 이동, 마음이 흔들림',
    );
    expect(
      formatSajuFacts(
        analyzeSajuDay({ natalPillars: SAMPLE_METAL, todayPillar: '甲午' }),
      ),
    ).toContain(
      '- 오늘 지지와 타고난 년주 지지(자, 뿌리·집안의 자리): 부딪힘 — 변화, 이동, 마음이 흔들림',
    );
    const harmony = formatSajuFacts(
      analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '甲子' }),
    );
    expect(harmony).toContain(
      '- 오늘 지지와 타고난 월주 지지(축, 일터·사회생활의 자리): 맞물림 — 끌림, 협력, 묶임',
    );
    const allFacts = [...clash, ...harmony].join('\n');
    expect(allFacts).not.toMatch(
      /편재|정재|식신|상관|정관|편관|비견|겁재|정인|편인|충|합/,
    );
  });

  it('분포 사실은 1/30 을 소수 첫째 자리로 보이고 판정은 정수로 한다', () => {
    const facts = formatSajuFacts(
      analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '戊辰' }),
    );
    expect(facts).toContainEqual(
      expect.stringContaining('나무 0.0 · 불 1.5 · 흙 2.8 · 쇠 2.3 · 물 1.3'),
    );
    expect(facts).toContainEqual(expect.stringContaining('가장 많은 기운: 흙'));
    expect(facts).toContainEqual(expect.stringContaining('없는 기운: 나무'));
    expect(facts.join('\n')).not.toContain('행운의 색');
  });

  it('정수로 같은 두 기운은 둘 다 가장 많은 기운이다', () => {
    // 甲 나무 30 ×3, 子(壬10 癸20) 물 30 ×3 — 나무 90 = 물 90.
    expect(
      formatSajuFacts(
        analyzeSajuDay({
          natalPillars: ['甲子', '甲子', '甲子'],
          todayPillar: '戊辰',
        }),
      ),
    ).toContainEqual(expect.stringContaining('가장 많은 기운: 나무·물'));
  });

  it('올해·이번 달 간지를 받으면 흐름 사실을 싣고, 없으면 싣지 않는다', () => {
    // 일간 己(흙·음) 기준: 丙 정인, 午(丁) 편인, 己 비견, 亥(壬) 정재.
    const facts = formatSajuFacts(
      analyzeSajuDay({
        natalPillars: SAMPLE_EARTH,
        todayPillar: '戊辰',
        yearMonthPillars: {
          yearPillar: '丙午',
          monthPillar: '己亥',
        },
      }),
    );
    expect(facts).toContain(
      '- 올해(병오년)의 흐름: 천간 불(양) → 나를 따뜻하게 돕는 기운 — 배움, 도움, 안정 / 지지 불(음) → 나를 돕되 독특한 기운 — 직관, 아이디어, 혼자 생각',
    );
    expect(facts).toContain(
      '- 이번 달(기해월)의 흐름: 천간 흙(음) → 나와 같은 기운 — 자기 주장, 동료, 경쟁 / 지지 물(양) → 내가 차곡차곡 다루는 기운 — 꾸준한 수입, 관리, 성실',
    );
    expect(facts.join('\n')).not.toMatch(/[一-鿿]/);
    expect(
      formatSajuFacts(
        analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '戊辰' }),
      ).join('\n'),
    ).not.toContain('흐름:');
  });

  it('가장 많은 기운이 오늘 또 들어오면 조절할 날이라고 적는다', () => {
    const facts = formatSajuFacts(
      analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '戊辰' }),
    );
    expect(facts).toContainEqual(
      expect.stringContaining('흙 기운은 이미 가장 많은 기운이다'),
    );
  });
});

describe('twelveStageOf', () => {
  it.each([
    ['甲', '寅'],
    ['乙', '卯'],
    ['丙', '巳'],
    ['丁', '午'],
    ['戊', '巳'],
    ['己', '午'],
    ['庚', '申'],
    ['辛', '酉'],
    ['壬', '亥'],
    ['癸', '子'],
  ])('%s 일간은 %s 에서 건록이다', (stem, branch) => {
    expect(twelveStageOf({ dayStem: stem, branch })).toBe('건록');
  });

  it('음간은 거꾸로 돌고 戊는 丙을 따른다', () => {
    expect(twelveStageOf({ dayStem: '乙', branch: '寅' })).toBe('제왕');
    expect(twelveStageOf({ dayStem: '戊', branch: '寅' })).toBe('장생');
  });
});

describe('voidBranchesOf', () => {
  const HEAVENLY = '甲乙丙丁戊己庚辛壬癸';
  const EARTHLY = '子丑寅卯辰巳午未申酉戌亥';
  const VOID_BY_DECADE = ['戌亥', '申酉', '午未', '辰巳', '寅卯', '子丑'];

  it('60갑자 전부 자기 순의 빈 두 지지를 낸다', () => {
    for (let index = 0; index < 60; index++) {
      const pillar = HEAVENLY[index % 10] + EARTHLY[index % 12];
      expect(voidBranchesOf(pillar).join('')).toBe(
        VOID_BY_DECADE[Math.floor(index / 10)],
      );
    }
  });
});

describe('stemRelationOf', () => {
  it.each(['甲己', '乙庚', '丙辛', '丁壬', '戊癸'])('%s 는 합이다', (pair) => {
    expect(stemRelationOf({ todayStem: pair[0], natalStem: pair[1] })).toBe(
      '합',
    );
    expect(stemRelationOf({ todayStem: pair[1], natalStem: pair[0] })).toBe(
      '합',
    );
  });

  it.each(['甲庚', '乙辛', '丙壬', '丁癸'])('%s 는 충이다', (pair) => {
    expect(stemRelationOf({ todayStem: pair[0], natalStem: pair[1] })).toBe(
      '충',
    );
  });

  it('戊·己 끼리와 같은 글자는 관계가 없다', () => {
    expect(stemRelationOf({ todayStem: '戊', natalStem: '己' })).toBeNull();
    expect(stemRelationOf({ todayStem: '甲', natalStem: '甲' })).toBeNull();
  });
});

describe('analyzeSajuDay — 기세·공망·천간·무리', () => {
  it('일간 자리까지 천간 관계를 본다', () => {
    // SAMPLE_EARTH 일간 己 + 오늘 甲 → 일주와 끌림.
    expect(
      analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '甲子' })
        .stemRelations,
    ).toContainEqual({
      kind: '합',
      natalLabel: '일주',
      natalStem: '己',
    });
  });

  it('오늘 일지가 타고난 지지와 삼합을 완성한다', () => {
    expect(
      analyzeSajuDay({
        natalPillars: ['甲申', '丙辰', '壬寅'],
        todayPillar: '甲子',
      }).harmonyGroup,
    ).toEqual({ kind: '삼합', element: '물', natalLabels: ['년주', '월주'] });
  });

  it('같은 글자는 무리 판정에서 빠진다', () => {
    // 오늘 申 = 원국 申 이라 빠지고, 남은 辰 과는 왕지가 없어 반합이 아니다.
    expect(
      analyzeSajuDay({
        natalPillars: ['甲申', '丙辰', '壬寅'],
        todayPillar: '庚申',
      }).harmonyGroup,
    ).toBeUndefined();
  });

  it('원국에 이미 완성된 무리는 오늘 새로 생기는 것이 없다', () => {
    expect(
      analyzeSajuDay({
        natalPillars: ['甲申', '甲子', '丙辰'],
        todayPillar: '庚子',
      }).harmonyGroup,
    ).toBeUndefined();
  });

  it('왕지가 낀 두 글자는 반합이다', () => {
    expect(
      analyzeSajuDay({
        natalPillars: ['甲午', '丁丑', '乙酉'],
        todayPillar: '庚寅',
      }).harmonyGroup,
    ).toEqual({ kind: '반합', element: '불', natalLabels: ['년주'] });
  });

  it('기세·공망·천간·무리 사실은 용어·한자 없이 싣는다', () => {
    // SAMPLE_EARTH 일주 己酉 → 甲辰순, 공망 寅卯. 오늘 甲寅: 공망, 일간 己와 끌림.
    const analysis = analyzeSajuDay({
      natalPillars: SAMPLE_EARTH,
      todayPillar: '甲寅',
    });
    expect(analysis.isVoidDay).toBe(true);
    const facts = formatSajuFacts(analysis);
    expect(facts).toContainEqual(expect.stringContaining('- 오늘의 기세:'));
    expect(facts).toContain('- 오늘은 새로 벌이기보다 정리·마무리하기 좋은 날');
    expect(facts).toContainEqual(
      expect.stringContaining('- 오늘 천간과 타고난 일주 천간'),
    );
    const harmonyFacts = formatSajuFacts(
      analyzeSajuDay({
        natalPillars: ['甲申', '丙辰', '壬寅'],
        todayPillar: '甲子',
      }),
    );
    expect(harmonyFacts).toContainEqual(expect.stringContaining('물 기운'));
    expect([...facts, ...harmonyFacts].join('\n')).not.toMatch(
      /[一-鿿]|편재|정재|식신|정관|편관|비견|겁재|정인|편인|공망|삼합|반합|충|합/,
    );
  });
});

describe('scoreFortune', () => {
  const base = {
    todayStemGroup: 2,
    todayBranchGroup: 2,
    strength: '보통' as const,
    hasBranchHarmony: false,
    isVoidDay: false,
  };

  it('천간·지지가 모두 얻는 기운이면 돈 5, 일·공부는 바닥 2', () => {
    expect(scoreFortune(base)).toEqual({
      총운: 3,
      '일·공부': 2,
      '사람 관계': 3,
      돈: 5,
      컨디션: 3,
    });
  });

  it('총운은 네 원점수 평균(.5 올림)에 기세를 더한다', () => {
    // 재성 + 비겁: 원점수 일·공부 2·관계 3·돈 3·컨디션 4 → 합 12 → 3.
    const mixed = { ...base, todayBranchGroup: 0 };
    expect(scoreFortune(mixed).총운).toBe(3);
    // 기세 강: 컨디션 5 → 합 13 → 3, 기세 +1 → 4.
    expect(scoreFortune({ ...mixed, strength: '강' }).총운).toBe(4);
    expect(scoreFortune({ ...mixed, strength: '강' }).컨디션).toBe(5);
  });

  it('공망은 일·공부를 깎되 지지가 맞물리면 깎지 않는다(해공)', () => {
    const study = { ...base, todayStemGroup: 4, todayBranchGroup: 1 };
    expect(scoreFortune(study)['일·공부']).toBe(4);
    expect(scoreFortune({ ...study, isVoidDay: true })['일·공부']).toBe(3);
    expect(
      scoreFortune({ ...study, isVoidDay: true, hasBranchHarmony: true })[
        '일·공부'
      ],
    ).toBe(4);
  });

  it('모든 점수는 2~5 다', () => {
    for (let stem = 0; stem < 5; stem++) {
      for (let branch = 0; branch < 5; branch++) {
        for (const strength of ['강', '보통', '약'] as const) {
          const scores = scoreFortune({
            ...base,
            todayStemGroup: stem,
            todayBranchGroup: branch,
            strength,
            isVoidDay: true,
          });
          for (const value of Object.values(scores)) {
            expect(value).toBeGreaterThanOrEqual(2);
            expect(value).toBeLessThanOrEqual(5);
          }
        }
      }
    }
  });
});

describe('analyzeSajuDay — 별점', () => {
  const GROUPS = [
    ['비견', '겁재'],
    ['식신', '상관'],
    ['편재', '정재'],
    ['편관', '정관'],
    ['편인', '정인'],
  ];
  const groupOf = (tenGod: string): number =>
    GROUPS.findIndex((pair) => pair.includes(tenGod));

  it('지지 충은 글로만 조심시키고 별점은 깎지 않는다', () => {
    // 癸亥: 시주 巳 와 충이 있다.
    const analysis = analyzeSajuDay({
      natalPillars: SAMPLE_EARTH,
      todayPillar: '癸亥',
    });
    expect(analysis.branchRelations.map(({ kind }) => kind)).toContain('충');
    expect(analysis.scores).toEqual(
      scoreFortune({
        todayStemGroup: groupOf(analysis.todayStem.tenGod),
        todayBranchGroup: groupOf(analysis.todayBranch.tenGod),
        strength: analysis.twelveStage.strength,
        hasBranchHarmony: analysis.hasBranchHarmony,
        isVoidDay: analysis.isVoidDay,
      }),
    );
  });

  it('별점은 지지·십성·기세만으로 정해진다 — 천간 끌림은 점수에 들지 않는다', () => {
    // 甲寅: 일간 己와 천간 끌림이 있다.
    const analysis = analyzeSajuDay({
      natalPillars: SAMPLE_EARTH,
      todayPillar: '甲寅',
    });
    expect(analysis.stemRelations.length).toBeGreaterThan(0);
    expect(analysis.scores).toEqual(
      scoreFortune({
        todayStemGroup: groupOf(analysis.todayStem.tenGod),
        todayBranchGroup: groupOf(analysis.todayBranch.tenGod),
        strength: analysis.twelveStage.strength,
        hasBranchHarmony: analysis.hasBranchHarmony,
        isVoidDay: analysis.isVoidDay,
      }),
    );
  });

  it('3기둥도 다섯 항목 점수와 세 갈래 결 사실을 낸다', () => {
    const analysis = analyzeSajuDay({
      natalPillars: SAMPLE_EARTH.slice(0, 3),
      todayPillar: '癸亥',
    });
    expect(Object.keys(analysis.scores)).toEqual([
      '총운',
      '일·공부',
      '사람 관계',
      '돈',
      '컨디션',
    ]);
    const toneLine = formatSajuFacts(analysis).find((fact) =>
      fact.startsWith('- 별점 결(코드가 정함):'),
    );
    expect(toneLine).toMatch(/총운 (좋은|무난한|조심할) 날/);
    expect(toneLine).not.toMatch(/[0-9★☆]/);
  });
});

describe('analyzeSajuDay — 오늘의 행운 기운', () => {
  const HEAVENLY = '甲乙丙丁戊己庚辛壬癸';
  const EARTHLY = '子丑寅卯辰巳午未申酉戌亥';
  const ELEMENT_ORDER = ['나무', '불', '흙', '쇠', '물'];
  // 천간 순번과 같은 순번의 지지는 늘 음양이 맞아 60갑자에 있는 기둥이다.
  const pillarOfStem = (index: number): string =>
    HEAVENLY[index] + EARTHLY[index];

  it.each([
    ['戊辰', '쇠'],
    ['庚午', '불'],
    ['壬申', '흙'],
    ['甲子', '불'],
    ['丙寅', '물'],
  ])('일간 己 + 오늘 %s → %s', (todayPillar, element) => {
    expect(
      analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar }).lucky.element,
    ).toBe(element);
  });

  it('나를 누르는 기운은 행운으로 뽑히지 않는다', () => {
    for (let dayStem = 0; dayStem < 10; dayStem++) {
      const pressing = ELEMENT_ORDER[(Math.floor(dayStem / 2) + 3) % 5];
      for (let todayStem = 0; todayStem < 10; todayStem++) {
        const natal = ['甲子', '甲子', pillarOfStem(dayStem)];
        expect(
          analyzeSajuDay({
            natalPillars: natal,
            todayPillar: pillarOfStem(todayStem),
          }).lucky.element,
        ).not.toBe(pressing);
      }
    }
  });

  it('숫자·음식은 오늘 천간 순번으로 고르고 색·맛·방향은 기운을 따른다', () => {
    // 庚午: 천간 순번 6, 행운 불.
    expect(
      analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '庚午' }).lucky,
    ).toEqual({
      element: '불',
      reason: '빠진 힘을 채워 주는 기운',
      color: '빨강',
      number: 2,
      taste: '쓴맛',
      food: '자몽',
      direction: '남쪽',
    });
  });

  it('사실에는 행운 기운과 이유만 싣고 숫자는 싣지 않는다', () => {
    const facts = formatSajuFacts(
      analyzeSajuDay({ natalPillars: SAMPLE_EARTH, todayPillar: '庚午' }),
    );
    expect(facts).toContain(
      '- 오늘의 행운 기운: 불 — 빠진 힘을 채워 주는 기운',
    );
    expect(facts.join('\n')).not.toContain('빨강');
  });
});
