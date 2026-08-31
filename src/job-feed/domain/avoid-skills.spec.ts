import { parseAvoidSkillTags } from './avoid-skills';

describe('parseAvoidSkillTags', () => {
  it('쉼표로 구분한 값을 트림하고 사전 정규명으로 바꾼다', () => {
    const result = parseAvoidSkillTags('php, jsp,');
    expect(result.identified).toEqual(['PHP', 'JSP']);
    expect(result.unmatched).toEqual([]);
  });

  it('사전에 없는 값도 필터에 쓴다 — 다만 표기가 정확히 같은 공고만 걸리므로 unmatched 로도 보고한다', () => {
    const result = parseAvoidSkillTags('php,Cobol');
    expect(result.identified).toEqual(['PHP', 'Cobol']);
    expect(result.unmatched).toEqual(['Cobol']);
  });

  it('undefined·빈 문자열은 빈 결과를 준다', () => {
    expect(parseAvoidSkillTags(undefined)).toEqual({
      identified: [],
      unmatched: [],
    });
    expect(parseAvoidSkillTags('')).toEqual({ identified: [], unmatched: [] });
  });
});
