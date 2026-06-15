import { CareerProfileData } from '../domain/career-mate.type';
import {
  buildPortfolioBlocks,
  formatPortfolioLink,
  formatProfileSummary,
  formatResume,
  formatUnknownCareerMate,
} from './career-mate.formatter';

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
      evidence: [{ repo: 'o/r', pr: 1, url: 'https://x/1', mergedAt: '2026-06-01' }],
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
});
