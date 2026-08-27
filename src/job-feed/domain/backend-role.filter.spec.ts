import { isBackendPosting } from './backend-role.filter';

describe('isBackendPosting', () => {
  it('제목에 백엔드 표기가 있으면 통과시킨다', () => {
    expect(
      isBackendPosting({
        title: '백엔드 개발자 경력 채용',
        skillTags: [],
        rawSkillTags: [],
      }),
    ).toBe(true);
    expect(
      isBackendPosting({
        title: 'AI Product Back-end Engineer',
        skillTags: [],
        rawSkillTags: [],
      }),
    ).toBe(true);
    expect(
      isBackendPosting({
        title: '서버 개발자',
        skillTags: [],
        rawSkillTags: [],
      }),
    ).toBe(true);
  });

  it('제목이 모호해도 서버 기술 스택이 둘 이상이면 통과시킨다', () => {
    expect(
      isBackendPosting({
        title: '개발팀 팀장',
        skillTags: ['Java', 'Spring Boot', 'AWS'],
        rawSkillTags: [],
      }),
    ).toBe(true);
  });

  it('프론트엔드 공고를 거른다 — 랠릿은 직군 필터가 듣지 않아 섞여 들어온다', () => {
    expect(
      isBackendPosting({
        title: '프론트엔드 개발자 (Front-end Developer)',
        skillTags: ['TypeScript'],
        rawSkillTags: ['React', 'Next.js', 'vite'],
      }),
    ).toBe(false);
  });

  it('직군 무관 인재풀 공고를 거른다', () => {
    expect(
      isBackendPosting({
        title: '[인재풀] 전 직군',
        skillTags: [],
        rawSkillTags: ['MS-Office', 'Slack'],
      }),
    ).toBe(false);
  });

  it('디자이너 공고를 거른다 — 카테고리 ID 를 잘못 넣으면 정상 응답으로 들어온다', () => {
    expect(
      isBackendPosting({
        title: 'UI/UX 디자이너',
        skillTags: [],
        rawSkillTags: ['Figma', 'Adobe Photoshop', '타이포그래피'],
      }),
    ).toBe(false);
  });

  it('제목이 백엔드여도 프론트 전용 스택뿐이면 거른다', () => {
    expect(
      isBackendPosting({
        title: '웹 개발자',
        skillTags: [],
        rawSkillTags: ['React', 'Vue', 'CSS'],
      }),
    ).toBe(false);
  });
});
