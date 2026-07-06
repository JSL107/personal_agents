import { CareerProfileData } from '../domain/career-mate.type';
import {
  buildPortfolioBlocks,
  buildResumeBlocks,
  formatCalibrationReport,
  formatGapReport,
  formatPortfolioLink,
  formatProfileSummary,
  formatPrRetro,
  formatResume,
  formatUnknownCareerMate,
} from './career-mate.formatter';

const GAP = {
  fitSummary: '핵심 부합 <b>강점</b>',
  have: ['NestJS'],
  gaps: ['K8s'],
  topics: [
    { title: 'K8s 회고', rationale: 'K8s 갭' },
    { title: '분산 큐 글', rationale: '트래픽 갭' },
  ],
};

const DATA: CareerProfileData = {
  summary: '백엔드 5년차',
  skills: [
    {
      name: 'NestJS',
      category: 'FRAMEWORK',
      proficiency: 'EXPERT',
      evidence: [{ repo: 'o/r', pr: 1, url: 'https://x/1' }],
    },
  ],
  accomplishments: [
    {
      title: '큐 락 안정화',
      bullet: 'BullMQ lockDuration 재설계로 stalled 0',
      star: { situation: 's', task: 't', action: 'a', result: 'r' },
      techTags: ['BullMQ'],
      evidence: [
        { repo: 'o/r', pr: 1, url: 'https://x/1', mergedAt: '2026-06-01' },
      ],
    },
  ],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

describe('career-mate.formatter', () => {
  it('formatProfileSummary 는 스킬/성과 수를 포함한다', () => {
    const text = formatProfileSummary(DATA);
    expect(text).toContain('스킬 1');
    expect(text).toContain('성과 1');
  });

  it('formatResume 는 bullet 을 포함한다', () => {
    expect(formatResume(DATA)).toContain('BullMQ lockDuration 재설계');
  });

  it('LLM 텍스트의 mrkdwn control 문자(&<>)를 escape 한다', () => {
    const injected: CareerProfileData = {
      ...DATA,
      summary: 'A & B <script> 위조',
      accomplishments: [{ ...DATA.accomplishments[0], bullet: '<b> & </b>' }],
    };
    const summary = formatProfileSummary(injected);
    expect(summary).toContain('&amp;');
    expect(summary).toContain('&lt;');
    expect(summary).not.toContain('<script>');
    expect(formatResume(injected)).toContain('&lt;b&gt;');
  });

  it('formatPortfolioLink 는 url 을 포함한다', () => {
    expect(formatPortfolioLink({ url: 'https://notion/abc' })).toContain(
      'https://notion/abc',
    );
  });

  it('buildPortfolioBlocks 는 heading 과 bullet 블록을 만든다', () => {
    const blocks = buildPortfolioBlocks(DATA);
    expect(blocks.some((b) => b.type === 'heading')).toBe(true);
    expect(blocks.some((b) => b.type === 'bullet')).toBe(true);
  });

  it('formatUnknownCareerMate 는 사용법을 안내한다', () => {
    expect(formatUnknownCareerMate()).toContain('프로필');
  });

  it('formatGapReport 는 번호 매긴 주제 + 선택 안내 + escape 를 포함한다', () => {
    const text = formatGapReport(GAP as never);
    expect(text).toContain('1.');
    expect(text).toContain('K8s 회고');
    expect(text).toContain('번'); // "원하는 번호를 말해주세요" 안내
    expect(text).toContain('&lt;b&gt;'); // LLM 텍스트 escape
  });

  it('formatCalibrationReport 는 섹션 + escape 를 포함한다', () => {
    const text = formatCalibrationReport(CAL as never);
    expect(text).toContain('정량 지표 추가');
    expect(text).toContain('IaC');
    expect(text).toContain('&lt;b&gt;'); // LLM 텍스트 escape
  });

  it('formatPrRetro 는 회고 서술·이력서 bullet·포폴 링크를 담고 escape 한다', () => {
    const text = formatPrRetro({
      accomplishment: {
        title: 'T <b>',
        bullet: 'B & 결과',
        star: { situation: 's', task: 't', action: 'a', result: 'r' },
        techTags: ['NestJS'],
        evidence: [{ repo: 'o/r', pr: 1692, url: 'u', mergedAt: '2026-06-30' }],
      },
      narrative: '회고 서술 <script>',
      portfolioUrl: 'https://notion/p',
      agentRunId: 1,
      modelUsed: 'claude',
    });
    expect(text).toContain('회고 서술');
    expect(text).toContain('B &amp; 결과');
    expect(text).toContain('https://notion/p');
    expect(text).not.toContain('<script>');
    expect(text).toContain('반영한 PR');
    expect(text).toContain('o/r#1692');
  });

  it('formatPrRetro 는 여러 evidence PR 을 모두 나열한다', () => {
    const text = formatPrRetro({
      accomplishment: {
        title: 'T',
        bullet: 'B',
        star: { situation: 's', task: 't', action: 'a', result: 'r' },
        techTags: ['NestJS'],
        evidence: [
          { repo: 'o/r', pr: 1, url: 'u1', mergedAt: '2026-06-29' },
          { repo: 'o/r', pr: 2, url: 'u2', mergedAt: '2026-06-30' },
        ],
      },
      narrative: '통합 회고',
      portfolioUrl: 'https://notion/p',
      agentRunId: 1,
      modelUsed: 'codex',
    });
    expect(text).toContain('o/r#1');
    expect(text).toContain('o/r#2');
  });
});

const CAL = {
  verdict: '견고 <b>하나</b> 정량 보강',
  aiSlopRisks: ['모호한 표현'],
  underQuantified: ['수치 없음'],
  outdatedPhrasing: [],
  missingKeywords: ['IaC'],
  actionItems: ['정량 지표 추가'],
};

describe('buildPortfolioBlocks — repo 그룹핑', () => {
  const acc = (title: string, repo: string | null, pr: number) => ({
    title,
    bullet: `${title}-bullet`,
    star: { situation: '', task: '', action: '', result: '' },
    techTags: [],
    evidence: repo
      ? [{ repo, pr, url: `https://x/${pr}`, mergedAt: '2026-01-01' }]
      : [],
  });

  it('같은 repo 성과는 한 프로젝트 heading 으로 묶는다', () => {
    const data: CareerProfileData = {
      summary: 's',
      skills: [],
      accomplishments: [acc('A', 'org/api', 1), acc('B', 'org/api', 2)],
      meta: { githubLogin: 'o', windowStart: '2026-01-01', prCount: 2 },
    };
    const headings = buildPortfolioBlocks(data)
      .filter((b) => b.type === 'heading')
      .map((b) => (b as { text: string }).text);
    expect(headings).toContain('프로젝트: org/api');
    expect(headings.filter((h) => h.startsWith('프로젝트:')).length).toBe(1);
  });

  it('evidence 없는 성과는 기타 프로젝트로', () => {
    const data: CareerProfileData = {
      summary: 's',
      skills: [],
      accomplishments: [acc('A', null, 0)],
      meta: { githubLogin: 'o', windowStart: '2026-01-01', prCount: 0 },
    };
    const headings = buildPortfolioBlocks(data)
      .filter((b) => b.type === 'heading')
      .map((b) => (b as { text: string }).text);
    expect(headings).toContain('프로젝트: 기타');
  });
});

describe('buildResumeBlocks', () => {
  it('성과 bullet 과 기술 스택을 담고 STAR 는 넣지 않는다', () => {
    const data: CareerProfileData = {
      summary: '요약',
      skills: [
        {
          name: 'NestJS',
          category: 'FRAMEWORK',
          proficiency: 'PROFICIENT',
          evidence: [],
        },
      ],
      accomplishments: [
        {
          title: 'T',
          bullet: '성과불릿',
          star: { situation: 'S값', task: '', action: '', result: '' },
          techTags: [],
          evidence: [],
        },
      ],
      meta: { githubLogin: 'o', windowStart: '2026-01-01', prCount: 1 },
    };
    const blocks = buildResumeBlocks(data);
    const texts = blocks.map((b) => ('text' in b ? b.text : '')).join('\n');
    expect(texts).toContain('성과불릿');
    expect(texts).toContain('NestJS (FRAMEWORK · PROFICIENT)');
    expect(texts).not.toContain('S값'); // STAR situation 미포함
  });
});
