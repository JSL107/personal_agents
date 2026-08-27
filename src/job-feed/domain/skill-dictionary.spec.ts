import { normalizeSkillTags } from './skill-dictionary';

describe('normalizeSkillTags', () => {
  it('소스마다 다른 표기를 같은 정규명으로 모은다', () => {
    expect(normalizeSkillTags(['Spring Boot']).matched).toEqual([
      'Spring Boot',
    ]);
    expect(normalizeSkillTags(['SpringBoot']).matched).toEqual(['Spring Boot']);
    expect(normalizeSkillTags(['spring boot']).matched).toEqual([
      'Spring Boot',
    ]);
    expect(normalizeSkillTags(['스프링부트']).matched).toEqual(['Spring Boot']);
  });

  it('프로필 쪽 표기도 같은 사전으로 정규화된다', () => {
    expect(normalizeSkillTags(['Node.js']).matched).toEqual(['Node.js']);
    expect(normalizeSkillTags(['nodejs']).matched).toEqual(['Node.js']);
  });

  it('사전에 없는 태그는 버리지 않고 unmatched 로 남긴다', () => {
    const result = normalizeSkillTags(['Java', 'Quarkus']);
    expect(result.matched).toEqual(['Java']);
    expect(result.unmatched).toEqual(['Quarkus']);
  });

  it('같은 기술이 여러 표기로 들어와도 한 번만 남긴다', () => {
    expect(normalizeSkillTags(['Spring Boot', 'SpringBoot']).matched).toEqual([
      'Spring Boot',
    ]);
  });

  it('빈 배열과 공백 문자열을 견딘다', () => {
    expect(normalizeSkillTags([])).toEqual({ matched: [], unmatched: [] });
    expect(normalizeSkillTags(['  '])).toEqual({ matched: [], unmatched: [] });
  });
});
