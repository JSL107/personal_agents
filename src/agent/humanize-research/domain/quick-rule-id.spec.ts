import { countMatches, findQuickRuleIds } from './proposal-gate';

const row =
  '| A-9 | "~에 의해" 피동 | S2 | 행위자를 주어로("AI에 의해 생성" → "AI가 만든") |';
const nextRow =
  '| A-10 | "~할 수 있다" 남발 | S2 | 단언으로("높일 수 있다" → "높인다") |';
const quickRules = `## 규칙\n${row}\n${nextRow}\n다른 설명`;

it('전체 규칙 행에서 규칙 ID를 찾는다', () => {
  expect(findQuickRuleIds({ quickRules, oldString: row })).toEqual(['A-9']);
});
it('처방 셀의 일부에서도 해당 행의 규칙 ID를 찾는다', () => {
  expect(
    findQuickRuleIds({ quickRules, oldString: '행위자를 주어로' }),
  ).toEqual(['A-9']);
});
it('두 규칙 행에 걸친 문구면 두 ID를 순서대로 반환한다', () => {
  const oldString = `${row}\n${nextRow}`;
  expect(findQuickRuleIds({ quickRules, oldString })).toEqual(['A-9', 'A-10']);
});
it('규칙 행이 아니거나 없는 문구와 빈 문구면 빈 배열을 반환한다', () => {
  expect(findQuickRuleIds({ quickRules, oldString: '다른 설명' })).toEqual([]);
  expect(findQuickRuleIds({ quickRules, oldString: '없는 문구' })).toEqual([]);
  expect(findQuickRuleIds({ quickRules, oldString: '' })).toEqual([]);
});
it('겹치는 문구를 세고 빈 검색어는 0 으로 센다', () => {
  expect(countMatches({ text: 'aaa', search: 'aa' })).toBe(2);
  expect(countMatches({ text: 'aaa', search: '' })).toBe(0);
});
