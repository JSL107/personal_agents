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

  it('contradiction 섹션 출력', () => {
    const text = formatKnowledgeLint(
      [
        {
          type: 'contradiction',
          episodeId: 1,
          relatedId: 2,
          detail: '모순 후보 — 결론 충돌',
          occurredAt,
        },
      ],
      '2026-06-28',
    );

    expect(text).toContain('모순 후보 1건');
    expect(text).toContain('#1 ↔ #2');
    expect(text).toContain('결론 충돌');
  });

  it('contradiction detail 의 mrkdwn 특수문자(LLM 출력) 제거', () => {
    const text = formatKnowledgeLint(
      [
        {
          type: 'contradiction',
          episodeId: 3,
          relatedId: 4,
          detail: '모순 후보 — *강조* _이탤릭_ `코드`',
          occurredAt,
        },
      ],
      '2026-06-28',
    );

    expect(text).not.toContain('*강조*');
    expect(text).not.toContain('`코드`');
    expect(text).toContain('강조');
  });
});
