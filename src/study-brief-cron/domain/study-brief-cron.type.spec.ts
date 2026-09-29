import { buildStudyResearchPrompt } from './study-brief-cron.type';

describe('buildStudyResearchPrompt', () => {
  it('프로필·최근 주제·설치 도구·kind 균형과 출력 계약을 포함한다', () => {
    const prompt = buildStudyResearchPrompt({
      profileSkills: ['TypeScript(EXPERT)'],
      recentTopics: ['Model Context Protocol'],
      kindBalance: { CONCEPT: 4, TOOL: 1 },
      installedTools: ['context7', 'serena'],
      adoptionHistory: [],
    });

    expect(prompt).toContain('TypeScript(EXPERT)');
    expect(prompt).toContain('사실상 같은 주제');
    expect(prompt).toContain('Model Context Protocol');
    expect(prompt).toContain('context7');
    expect(prompt).toContain('TOOL');
    expect(prompt).toContain('KIND: CONCEPT');
    expect(prompt).toContain('NO_TOPIC:');
    expect(prompt).toContain('1,200~1,800자');
    expect(prompt).toContain('## 세 줄 요약');
    expect(prompt).toContain('## 알아야 할 것');
    expect(prompt).toContain('## 오늘 할 일');
  });

  it('프로필이 없으면 기본 개발자 설명을 사용한다', () => {
    const prompt = buildStudyResearchPrompt({
      profileSkills: undefined,
      recentTopics: [],
      kindBalance: { CONCEPT: 0, TOOL: 0 },
      installedTools: [],
      adoptionHistory: [],
    });

    expect(prompt).toContain('TypeScript·NestJS 백엔드 개발자');
  });

  it('명시 결정이 3건 미만이면 되먹임 블록을 넣지 않는다', () => {
    const prompt = buildStudyResearchPrompt({
      profileSkills: undefined,
      recentTopics: [],
      kindBalance: { CONCEPT: 0, TOOL: 0 },
      installedTools: [],
      adoptionHistory: [
        { topic: 'A', outcome: 'ADOPTED' },
        { topic: 'B', outcome: 'REJECTED' },
      ],
    });
    expect(prompt).not.toContain('[실제로 코드에 반영하기로 한 방향]');
  });

  it('3건 이상이면 채택·거절 블록을 나눠 넣는다', () => {
    const prompt = buildStudyResearchPrompt({
      profileSkills: undefined,
      recentTopics: [],
      kindBalance: { CONCEPT: 0, TOOL: 0 },
      installedTools: [],
      adoptionHistory: [
        { topic: 'A', outcome: 'ADOPTED' },
        { topic: 'B', outcome: 'REJECTED' },
        { topic: 'C', outcome: 'ADOPTED' },
      ],
    });
    expect(prompt).toContain('[실제로 코드에 반영하기로 한 방향]\n- A\n- C');
    expect(prompt).toContain('[제안했으나 채택하지 않은 방향]\n- B');
  });
});
