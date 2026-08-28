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

  it('중복 제거가 입력 순서에 영향받지 않는다 — 자기 이름이 별칭 키에 없는 정규명이 먼저 와도 매칭을 막지 않는다', () => {
    // 'Message Queue'는 사전의 정규명이지만 별칭 키('messagequeue')로도 등록돼
    // 있어야 한다. 등록 전에는 이 값이 먼저 오면 "사전에 없는 원본"으로 잘못
    // 분류돼, 같은 seen 집합을 공유하는 뒤의 진짜 매칭('queue')까지 막았다.
    expect(normalizeSkillTags(['Message Queue', 'queue'])).toEqual({
      matched: ['Message Queue'],
      unmatched: [],
    });
    expect(normalizeSkillTags(['queue', 'Message Queue'])).toEqual({
      matched: ['Message Queue'],
      unmatched: [],
    });
  });
});
