import {
  ELEMENT_FOODS,
  HIDDEN_STEM_DAYS,
  SCORE_ADJUSTMENTS,
} from './saju-tables';

const EARTHLY_BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const BRANCH_MAIN_STEMS = '癸己甲乙戊丙丁己庚辛戊壬';

describe('HIDDEN_STEM_DAYS', () => {
  it('지장간 일수는 지지마다 합이 30이고 마지막(정기)이 본기와 같다', () => {
    [...EARTHLY_BRANCHES].forEach((branch, index) => {
      const hidden = HIDDEN_STEM_DAYS[branch];
      expect(hidden.reduce((sum, [, days]) => sum + days, 0)).toBe(30);
      expect(hidden[hidden.length - 1][0]).toBe(BRANCH_MAIN_STEMS[index]);
    });
  });
});

describe('ELEMENT_FOODS', () => {
  it('오행마다 5개이고 Slack 제어 문자가 없다', () => {
    expect(ELEMENT_FOODS).toHaveLength(5);
    for (const foods of ELEMENT_FOODS) {
      expect(foods).toHaveLength(5);
      for (const food of foods) {
        expect(food).not.toMatch(/[&<>*_~`]/);
      }
    }
  });
});

describe('SCORE_ADJUSTMENTS', () => {
  it('십성 갈래(비겁·식상·재성·관성·인성) 다섯 줄을 가진다', () => {
    expect(SCORE_ADJUSTMENTS.tenGodGroups).toHaveLength(5);
  });
});
