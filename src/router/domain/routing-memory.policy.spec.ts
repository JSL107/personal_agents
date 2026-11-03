import {
  decideMemoryShortcut,
  normalizeRoutingText,
  pickRoutingFewshot,
  RoutingMemoryHit,
} from './routing-memory.policy';

const hit = (
  agentType: string | null,
  content: string,
  similarity: number,
): RoutingMemoryHit => ({ agentType, content, similarity });

const RULE = { threshold: 0.93, k: 2 };

describe('normalizeRoutingText', () => {
  it('Slack 멘션 토큰과 공백 차이를 지운다', () => {
    expect(normalizeRoutingText('<@U0AULUXLF9B>  이 영상\n요약해줘 ')).toBe(
      '이 영상 요약해줘',
    );
  });
});

describe('decideMemoryShortcut', () => {
  it('서로 다른 문장 상위 k 개가 모두 T 이상이고 같은 담당이면 그 담당', () => {
    expect(
      decideMemoryShortcut({
        hits: [
          hit('SCHEDULE', '내일 3시 회의 잡아줘', 0.97),
          hit('SCHEDULE', '모레 2시 회의 잡아줘', 0.94),
        ],
        rule: RULE,
      }),
    ).toEqual({ agentType: 'SCHEDULE', similarity: 0.97 });
  });

  it('k 번째 문장이 T 미만이면 단축하지 않는다', () => {
    expect(
      decideMemoryShortcut({
        hits: [hit('SCHEDULE', 'a', 0.97), hit('SCHEDULE', 'b', 0.92)],
        rule: RULE,
      }),
    ).toBeNull();
  });

  it('상위 k 개의 담당이 갈리면 단축하지 않는다', () => {
    expect(
      decideMemoryShortcut({
        hits: [hit('SCHEDULE', 'a', 0.97), hit('VACATION', 'b', 0.96)],
        rule: RULE,
      }),
    ).toBeNull();
  });

  // 같은 문장 여러 벌이 k 합의를 위조하면 발화 1건으로 LLM 을 건너뛴다.
  it('같은 (문장, 담당) 은 하나로 접어 k 를 센다', () => {
    expect(
      decideMemoryShortcut({
        hits: [
          hit('SCHEDULE', '회의 잡아줘', 0.99),
          hit('SCHEDULE', '회의 잡아줘', 0.99),
          hit('VACATION', '휴가 내줘', 0.5),
        ],
        rule: RULE,
      }),
    ).toBeNull();
  });

  it('같은 문장이 서로 다른 담당으로 남아 있으면 불일치로 떨어진다', () => {
    expect(
      decideMemoryShortcut({
        hits: [hit('SCHEDULE', '정리해줘', 0.99), hit('PM', '정리해줘', 0.99)],
        rule: RULE,
      }),
    ).toBeNull();
  });

  it('예시가 k 개보다 적으면 단축하지 않는다', () => {
    expect(
      decideMemoryShortcut({ hits: [hit('SCHEDULE', 'a', 0.99)], rule: RULE }),
    ).toBeNull();
  });

  it('입력 순서와 무관하게 유사도 순으로 본다', () => {
    expect(
      decideMemoryShortcut({
        hits: [
          hit('VACATION', 'c', 0.5),
          hit('SCHEDULE', 'b', 0.95),
          hit('SCHEDULE', 'a', 0.98),
        ],
        rule: RULE,
      }),
    ).toEqual({ agentType: 'SCHEDULE', similarity: 0.98 });
  });
});

describe('pickRoutingFewshot', () => {
  it('floor 미만을 버리고 담당마다 가장 가까운 1개, 최대 3개', () => {
    const picked = pickRoutingFewshot({
      hits: [
        hit('CODE_REVIEWER', 'a', 0.95),
        hit('CODE_REVIEWER', 'b', 0.94),
        hit('PM', 'c', 0.9),
        hit('BLOG', 'd', 0.88),
        hit('SCHEDULE', 'e', 0.86),
        hit('VACATION', 'f', 0.7),
        hit(null, 'g', 0.99),
      ],
      floor: 0.8,
    });
    expect(picked.map((item) => item.content)).toEqual(['a', 'c', 'd']);
  });
});
