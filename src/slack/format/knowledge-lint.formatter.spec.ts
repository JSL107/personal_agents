import { formatKnowledgeLint } from './knowledge-lint.formatter';

// 후보 2쌍을 전부 판정한 정상 실태.
const L4_DONE = { candidates: 2, judged: 2, abortedByQuota: false };

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
      L4_DONE,
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
      L4_DONE,
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
      L4_DONE,
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
      L4_DONE,
    );

    expect(text).not.toContain('*강조*');
    expect(text).not.toContain('`코드`');
    expect(text).toContain('강조');
  });

  // 이 아래가 하트비트의 존재 이유다 — 0건에 빈 문자열/skip 을 돌려주면 "점검했고 깨끗하다" 가
  // "점검이 안 돌았다" 와 구분되지 않는다.
  it('이상 0건이면 1줄 하트비트 (실제 판정 쌍 수 포함)', () => {
    const text = formatKnowledgeLint([], '2026-06-28', L4_DONE);

    expect(text).toContain('✅');
    expect(text).toContain('이상 없음');
    expect(text).toContain('2026-06-28');
    expect(text).toContain('모순 2쌍 판정');
    expect(text.split('\n')).toHaveLength(1);
  });

  it('L4 를 수행하지 않았으면(null) 모순을 안 봤다고 표시한다', () => {
    const text = formatKnowledgeLint([], '2026-06-28', null);

    expect(text).toContain('이상 없음');
    expect(text).toContain('모순 판정 꺼짐');
  });

  // 아래 세 건이 codex 리뷰(PR #269 P2)가 지적한 위장 경로다 — L4 를 끝까지 못 돌린 회차에
  // ✅ "이상 없음" 을 내보내면 점검 장애가 정상으로 보인다.
  it('쿼터로 L4 가 중단됐으면 0건이어도 ✅ 를 쓰지 않는다', () => {
    const text = formatKnowledgeLint([], '2026-06-28', {
      candidates: 5,
      judged: 1,
      abortedByQuota: true,
    });

    expect(text).toContain('⚠️');
    expect(text).not.toContain('✅');
    expect(text).not.toContain('episodic-memory 이상 없음');
    expect(text).toContain('1/5쌍만 판정');
    expect(text).toContain('쿼터 소진');
  });

  it('일부 judge 실패로 후보를 다 못 본 회차도 ✅ 를 쓰지 않는다', () => {
    const text = formatKnowledgeLint([], '2026-06-28', {
      candidates: 3,
      judged: 2,
      abortedByQuota: false,
    });

    expect(text).toContain('⚠️');
    expect(text).not.toContain('✅');
    expect(text).toContain('2/3쌍만 판정');
  });

  it('이슈가 있는 회차에도 L4 부분 실패를 함께 알린다', () => {
    const text = formatKnowledgeLint(
      [
        {
          type: 'embedding_null',
          episodeId: 9,
          detail: 'embedding 누락',
          occurredAt,
        },
      ],
      '2026-06-28',
      { candidates: 4, judged: 1, abortedByQuota: true },
    );

    expect(text).toContain('임베딩 누락 1건');
    // 보고된 목록이 전부가 아님을 밝혀야 한다.
    expect(text).toContain('전부가 아닐 수 있습니다');
    expect(text).toContain('1/4쌍만 판정');
  });
});
