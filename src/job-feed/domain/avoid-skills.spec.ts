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

  it('기술이 아닌 값은 걸러지지 않는다는 사실을 dropped 로 알린다', () => {
    // 저장된 skillTags 에서 이미 빠진 태그라 필터가 걸릴 대상이 없다. 조용히 넘기면
    // "설정했는데 안 걸리고 경고도 없는" 상태가 된다.
    const result = parseAvoidSkillTags('php,Figma');
    expect(result.identified).toEqual(['PHP']);
    expect(result.dropped).toEqual(['Figma']);
  });

  it('undefined·빈 문자열은 빈 결과를 준다', () => {
    expect(parseAvoidSkillTags(undefined)).toEqual({
      identified: [],
      unmatched: [],
      dropped: [],
    });
    expect(parseAvoidSkillTags('')).toEqual({
      identified: [],
      unmatched: [],
      dropped: [],
    });
  });
});
