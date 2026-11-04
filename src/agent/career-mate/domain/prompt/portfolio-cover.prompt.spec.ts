import {
  buildPortfolioCoverPrompt,
  parsePortfolioCoverOutput,
} from './portfolio-cover.prompt';

const card = {
  key: 'sample',
  repo: 'acme-corp/internal-api',
  anonymized: true,
  period: '2026.06',
  techStack: ['TypeScript'],
  processLines: ['사내 저장소의 오류를 3회에서 0회로 줄였다'],
  previousTitle: '이전 제목',
  previousSummary: '이전 요약',
};

describe('portfolio cover prompt', () => {
  it('익명 카드에는 저장소 경로 없이 과정 10줄만 전달한다', () => {
    const prompt = buildPortfolioCoverPrompt([
      { ...card, processLines: Array(12).fill('과정') },
    ]);
    expect(prompt).not.toContain(card.repo);
    expect(prompt).toContain('anonymous: true');
    expect(prompt).toContain('10. 과정');
    expect(prompt).not.toContain('11. 과정');
  });

  it('JSON 파손은 빈 목록으로 처리한다', () => {
    expect(
      parsePortfolioCoverOutput({ text: '깨진 JSON', allowedKeys: ['sample'] }),
    ).toEqual([]);
  });

  it('입력 외 key와 중복 key는 버린다', () => {
    const item = {
      key: 'sample',
      title: '제목',
      summary: '요약',
      problem: '문제',
      result: '결과',
      highlights: [],
    };
    const output = JSON.stringify({
      projects: [
        item,
        { ...item, title: '뒤의 제목' },
        { ...item, key: 'other' },
      ],
    });
    expect(
      parsePortfolioCoverOutput({ text: output, allowedKeys: ['sample'] }),
    ).toEqual([item]);
  });
});
