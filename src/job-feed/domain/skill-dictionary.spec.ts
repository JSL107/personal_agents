import { normalizeSkillTags, toSkillKey } from './skill-dictionary';

describe('normalizeSkillTags', () => {
  it('소스마다 다른 표기를 같은 정규명으로 모은다', () => {
    expect(normalizeSkillTags(['Spring Boot']).identified).toEqual([
      'Spring Boot',
    ]);
    expect(normalizeSkillTags(['SpringBoot']).identified).toEqual([
      'Spring Boot',
    ]);
    expect(normalizeSkillTags(['spring boot']).identified).toEqual([
      'Spring Boot',
    ]);
    expect(normalizeSkillTags(['스프링부트']).identified).toEqual([
      'Spring Boot',
    ]);
  });

  it('프로필 쪽 표기도 같은 사전으로 정규화된다', () => {
    expect(normalizeSkillTags(['Node.js']).identified).toEqual(['Node.js']);
    expect(normalizeSkillTags(['nodejs']).identified).toEqual(['Node.js']);
  });

  // 🔴 이 파일의 핵심 회귀 테스트. 사전에 없는 태그를 결과에서 빼면 그 태그가 채점
  // 분모에서 사라져 점수가 부풀려진다 — 2026-08-31 실측에서 React·CSS·HTML·Figma 만
  // 적힌 공고가 JavaScript 하나로 만점을 받았다.
  it('사전에 없는 태그도 요구 기술로 남긴다 — 빼면 채점 분모에서 사라져 점수가 부풀려진다', () => {
    const result = normalizeSkillTags(['Java', 'Quarkus']);
    expect(result.identified).toEqual(['Java', 'Quarkus']);
    // 사전 보강 재료로도 따로 보고한다.
    expect(result.unmatched).toEqual(['Quarkus']);
  });

  it('사전에 없는 프론트 기술도 요구 기술로 센다 — 사전은 무엇이 기술인지 정하지 않는다', () => {
    const result = normalizeSkillTags(['React', 'CSS', 'HTML', 'JavaScript']);
    expect(result.identified).toEqual(['React', 'CSS', 'HTML', 'JavaScript']);
    expect(result.unmatched).toEqual(['React', 'CSS', 'HTML']);
  });

  it('기술이 아닌 직무·범주·협업도구 태그는 뺀다 — 분모에 넣으면 요구사항을 성실히 적은 공고가 불리해진다', () => {
    const result = normalizeSkillTags([
      'Java',
      'backend',
      '프로젝트 관리',
      'JIRA',
      'Figma',
      'DBMS/RDBMS',
    ]);
    expect(result.identified).toEqual(['Java']);
    // 사전 보강 재료도 아니다 — 넣어봐야 매칭에 쓸 수 없다.
    expect(result.unmatched).toEqual([]);
  });

  it('같은 기술이 여러 표기로 들어와도 한 번만 남긴다', () => {
    expect(
      normalizeSkillTags(['Spring Boot', 'SpringBoot']).identified,
    ).toEqual(['Spring Boot']);
  });

  it('사전에 없는 태그도 대소문자만 다르면 한 번만 센다 — 분모가 표기 흔들림으로 부풀지 않게', () => {
    const result = normalizeSkillTags(['OpenCV', 'opencv', 'Open-CV']);
    expect(result.identified).toEqual(['OpenCV']);
    expect(result.unmatched).toEqual(['OpenCV']);
  });

  it('빈 배열과 공백 문자열을 견딘다', () => {
    expect(normalizeSkillTags([])).toEqual({ identified: [], unmatched: [] });
    expect(normalizeSkillTags(['  '])).toEqual({
      identified: [],
      unmatched: [],
    });
  });

  it('실측 미매칭 상위로 보강한 백엔드 기술을 정규명으로 매칭한다', () => {
    expect(normalizeSkillTags(['SQL']).identified).toEqual(['SQL']);
    expect(normalizeSkillTags(['Oracle']).identified).toEqual(['Oracle']);
    expect(normalizeSkillTags(['MSSQL']).identified).toEqual(['MSSQL']);
    expect(normalizeSkillTags(['NoSql']).identified).toEqual(['NoSQL']);
    expect(normalizeSkillTags(['PHP']).identified).toEqual(['PHP']);
    expect(normalizeSkillTags(['JSP']).identified).toEqual(['JSP']);
    expect(normalizeSkillTags(['PyTorch']).identified).toEqual(['PyTorch']);
    expect(normalizeSkillTags(['LLM']).identified).toEqual(['LLM']);
  });

  it('Google Cloud Platform 풀네임을 기존 GCP 별칭과 같은 정규명으로 묶는다', () => {
    expect(normalizeSkillTags(['Google Cloud Platform']).identified).toEqual([
      'GCP',
    ]);
    expect(normalizeSkillTags(['gcp']).identified).toEqual(['GCP']);
  });

  it('2026-08-31 보강 — 표기만 다른 같은 기술이 서로 만난다', () => {
    // 'spring' 별칭은 있었지만 풀네임 표기가 없어 실측 19건이 통째로 샜다.
    expect(normalizeSkillTags(['Spring Framework']).identified).toEqual([
      'Spring Boot',
    ]);
    expect(normalizeSkillTags(['spring-framework']).identified).toEqual([
      'Spring Boot',
    ]);
    // 형상관리 플랫폼 표기 — 실측 20건.
    expect(normalizeSkillTags(['Github']).identified).toEqual(['Git']);
    expect(normalizeSkillTags(['GitHub']).identified).toEqual(['Git']);
    // AWS 세부 서비스는 개별 정규명을 만들면 프로필의 'AWS' 와 못 만난다.
    expect(normalizeSkillTags(['aws-rds', 'Lambda', 'ec2']).identified).toEqual(
      ['AWS'],
    );
    expect(
      normalizeSkillTags(['restful', 'api', 'Web API']).identified,
    ).toEqual(['REST API']);
    expect(normalizeSkillTags(['OAuth 2.0']).identified).toEqual(['OAuth']);
    expect(normalizeSkillTags(['Firestore']).identified).toEqual(['Firebase']);
  });

  it('중복 제거가 입력 순서에 영향받지 않는다 — 자기 이름이 별칭 키에 없는 정규명이 먼저 와도 매칭을 막지 않는다', () => {
    // 'Message Queue'는 사전의 정규명이지만 별칭 키('messagequeue')로도 등록돼
    // 있어야 한다. 등록 전에는 이 값이 먼저 오면 "사전에 없는 원본"으로 잘못
    // 분류돼, 같은 seen 집합을 공유하는 뒤의 진짜 매칭('queue')까지 막았다.
    expect(normalizeSkillTags(['Message Queue', 'queue'])).toEqual({
      identified: ['Message Queue'],
      unmatched: [],
    });
    expect(normalizeSkillTags(['queue', 'Message Queue'])).toEqual({
      identified: ['Message Queue'],
      unmatched: [],
    });
  });

  // 사전과 비기술 목록에 같은 키를 넣으면 비기술 판정이 먼저라 사전 항목이 조용히
  // 죽는다. 겹치는 순간 실패하게 해서 다음 보강 때 눈에 띄게 한다.
  it('비기술 목록과 사전 별칭이 겹치지 않는다 — 겹치면 사전 쪽이 조용히 무시된다', () => {
    for (const [alias, canonical] of [
      ['api', 'REST API'],
      ['github', 'Git'],
      ['linux', 'Linux'],
      ['sql', 'SQL'],
    ] as const) {
      expect(normalizeSkillTags([alias]).identified).toEqual([canonical]);
    }
  });
});

describe('toSkillKey', () => {
  it('대소문자·공백·점·하이픈·언더스코어를 지워 같은 기술을 한 키로 모은다', () => {
    expect(toSkillKey('Node.js')).toBe('nodejs');
    expect(toSkillKey('Spring Boot')).toBe('springboot');
    expect(toSkillKey('spring-framework')).toBe('springframework');
    expect(toSkillKey('REACT')).toBe('react');
  });
});
