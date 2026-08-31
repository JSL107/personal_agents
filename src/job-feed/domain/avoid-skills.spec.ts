import { parseAvoidSkillTags } from './avoid-skills';

describe('parseAvoidSkillTags', () => {
  it('쉼표로 구분한 값을 트림하고 사전 정규명으로 바꾼다', () => {
    const result = parseAvoidSkillTags('php, jsp,');
    expect(result.matched).toEqual(['PHP', 'JSP']);
    expect(result.unmatched).toEqual([]);
  });

  it('사전에 없는 값은 matched 에서 빠지고 unmatched 로 돌아온다', () => {
    const result = parseAvoidSkillTags('php,Cobol');
    expect(result.matched).toEqual(['PHP']);
    expect(result.unmatched).toEqual(['Cobol']);
  });

  it('undefined·빈 문자열은 빈 결과를 준다', () => {
    expect(parseAvoidSkillTags(undefined)).toEqual({
      matched: [],
      unmatched: [],
    });
    expect(parseAvoidSkillTags('')).toEqual({ matched: [], unmatched: [] });
  });
});
