import { formatKnowledgeLint } from './knowledge-lint.formatter';

describe('formatKnowledgeLint', () => {
  const occurredAt = new Date('2026-06-20T00:00:00Z');

  it('중복/임베딩누락 섹션과 건수를 포함', () => {
    const text = formatKnowledgeLint(
      [
        {
          type: 'near_duplicate',
          episodeId: 1,
          relatedId: 2,
          detail: '중복 후보 — distance 0.010',
          occurredAt,
        },
        {
          type: 'embedding_null',
          episodeId: 9,
          detail: 'embedding 누락 — 벡터 검색에서 제외됨',
          occurredAt,
        },
      ],
      '2026-06-28',
    );

    expect(text).toContain('Knowledge Lint');
    expect(text).toContain('중복 후보 1건');
    expect(text).toContain('#1 ↔ #2');
    expect(text).toContain('임베딩 누락 1건');
    expect(text).toContain('#9');
  });

  it('한 종류만 있으면 해당 섹션만 출력', () => {
    const text = formatKnowledgeLint(
      [
        {
          type: 'embedding_null',
          episodeId: 5,
          detail: 'x',
          occurredAt,
        },
      ],
      '2026-06-28',
    );

    expect(text).toContain('임베딩 누락 1건');
    expect(text).not.toContain('중복 후보');
  });
});
