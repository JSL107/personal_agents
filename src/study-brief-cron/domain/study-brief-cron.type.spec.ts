import { CareerProfileData } from '../../agent/career-mate/domain/career-mate.type';
import { buildStudyResearchPrompt } from './study-brief-cron.type';

const PROFILE: CareerProfileData = {
  summary: 'NestJS 에이전트 백엔드 개발자',
  skills: [
    {
      name: 'TypeScript',
      category: 'LANGUAGE',
      proficiency: 'EXPERT',
      evidence: [{ repo: 'owner/repo', pr: 1, url: 'https://secret.example' }],
    },
  ],
  accomplishments: [],
  meta: { githubLogin: 'owner', windowStart: '2026-07-01', prCount: 1 },
};

describe('buildStudyResearchPrompt', () => {
  it('프로필·최근 주제·설치 도구·kind 균형과 출력 계약을 포함한다', () => {
    const prompt = buildStudyResearchPrompt({
      profile: PROFILE,
      recentTopics: ['Model Context Protocol'],
      kindBalance: { CONCEPT: 4, TOOL: 1 },
      installedTools: ['context7', 'serena'],
    });

    expect(prompt).toContain('NestJS 에이전트 백엔드 개발자');
    expect(prompt).toContain('TypeScript (EXPERT)');
    expect(prompt).not.toContain('https://secret.example');
    expect(prompt).toContain('사실상 같은 주제');
    expect(prompt).toContain('Model Context Protocol');
    expect(prompt).toContain('context7');
    expect(prompt).toContain('TOOL');
    expect(prompt).toContain('KIND: CONCEPT');
    expect(prompt).toContain('NO_TOPIC:');
  });

  it('프로필이 없으면 기본 개발자 설명을 사용한다', () => {
    const prompt = buildStudyResearchPrompt({
      profile: undefined,
      recentTopics: [],
      kindBalance: { CONCEPT: 0, TOOL: 0 },
      installedTools: [],
    });

    expect(prompt).toContain('TypeScript·NestJS 백엔드 개발자');
  });
});
