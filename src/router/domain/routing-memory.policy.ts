// 라우팅 기억(routing_example) 판정 규칙 — pure TS.
// 오프라인 평가 스크립트도 이 함수를 그대로 import 한다. 규칙이 두 벌이면 평가가 운영을 증명하지 못한다.
// 값의 근거·사전 등록 기준: docs/superpowers/plans/2026-11-02-routing-memory-shortcut.md

export interface RoutingMemoryHit {
  agentType: string | null;
  content: string;
  // 감쇠 없는 cosine similarity.
  similarity: number;
}

export interface MemoryShortcutRule {
  threshold: number;
  k: number;
}

export interface MemoryShortcutDecision {
  agentType: string;
  similarity: number;
}

export interface DecideMemoryShortcutInput {
  hits: RoutingMemoryHit[];
  rule: MemoryShortcutRule;
}

// T: 호출부의 hit 타입(EpisodeSearchHit 등)을 그대로 돌려주려고 받는다 — 도메인이 바깥 타입을 몰라도 된다.
export interface PickRoutingFewshotInput<T extends RoutingMemoryHit> {
  hits: T[];
  floor?: number;
  limit?: number;
}

// 잠정값 — 2026-11-02 사전 등록 스윕에서 기준(단축 ≥9/101 · 오분류 ≤1)을 만족한 칸이 없었다.
// 그래서 단축은 기본 off 이고, 이 값은 shadow 관측용이다: 운영 풀(예시 33건)에서 오분류 0 인 칸 중
// 가장 많이 걸린 칸(2/101). 값을 바꾸면 사전 등록 평가를 처음부터 다시 한다.
export const MEMORY_SHORTCUT_RULE: MemoryShortcutRule = {
  threshold: 0.93,
  k: 2,
};
// few-shot 으로 붙일 최소 유사도. 사전 등록 규칙(정답 포함 ≥60% 를 지키는 가장 높은 값)으로 정했다.
export const ROUTING_FEWSHOT_FLOOR = 0.8;
export const ROUTING_FEWSHOT_LIMIT = 3;
// 한 번 검색으로 단축 판정과 few-shot 을 함께 뽑는다 — 담당별 1개 × 3 과 서로 다른 문장 k 개를 채울 여유.
export const ROUTING_MEMORY_SEARCH_LIMIT = 20;

/**
 * 저장·검색·백필이 같은 모양의 문장을 보도록 Slack 멘션 토큰, 서식 기호, 공백 차이를 지운다.
 * 서식이 붙은 같은 문장이 다른 문장처럼 멀어지지 않게 한다.
 * - 백틱은 Slack 에서 언제나 코드 서식이라 모두 지운다.
 * - `*` 는 단어 양끝의 굵게 표시만 지운다. `2*3`·`src/**\/*.ts` 같은 내용은 남긴다(이대리 리뷰 #954).
 */
export const normalizeRoutingText = (text: string): string =>
  text
    .replace(/<@[A-Z0-9]+>/g, ' ')
    .replace(/`+/g, '')
    .replace(/(^|\s)\*+|\*+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

const bySimilarityDesc = <T extends RoutingMemoryHit>(hits: T[]): T[] =>
  [...hits].sort((first, second) => second.similarity - first.similarity);

/**
 * 서로 다른 과거 문장 상위 k 개가 모두 threshold 이상이고 같은 담당을 가리킬 때만 그 담당을 돌려준다.
 *
 * 같은 (문장, 담당) 은 하나로 접는다 — 같은 문장 3벌이 k=3 합의를 위조하지 못하게. 같은 문장이
 * 서로 다른 담당으로 남아 있으면 둘 다 남겨 불일치로 떨어지게 한다.
 */
export const decideMemoryShortcut = ({
  hits,
  rule,
}: DecideMemoryShortcutInput): MemoryShortcutDecision | null => {
  const seen = new Set<string>();
  const distinct: RoutingMemoryHit[] = [];
  for (const hit of bySimilarityDesc(hits)) {
    const key = `${hit.agentType ?? ''}\u0000${hit.content}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    distinct.push(hit);
  }
  const top = distinct.slice(0, rule.k);
  if (top.length < rule.k) {
    return null;
  }
  const agentType = top[0].agentType;
  const agreed = top.every(
    (hit) => hit.agentType === agentType && hit.similarity >= rule.threshold,
  );
  if (agentType === null || !agreed) {
    return null;
  }
  return { agentType, similarity: top[0].similarity };
};

/** few-shot 예시: floor 이상, 담당마다 가장 가까운 1개, 최대 limit 개. 한 담당으로 쏠리지 않게 한다. */
export const pickRoutingFewshot = <T extends RoutingMemoryHit>({
  hits,
  floor = ROUTING_FEWSHOT_FLOOR,
  limit = ROUTING_FEWSHOT_LIMIT,
}: PickRoutingFewshotInput<T>): T[] => {
  const picked: T[] = [];
  const workers = new Set<string>();
  for (const hit of bySimilarityDesc(hits)) {
    if (hit.agentType === null || hit.similarity < floor) {
      continue;
    }
    if (workers.has(hit.agentType)) {
      continue;
    }
    workers.add(hit.agentType);
    picked.push(hit);
    if (picked.length === limit) {
      break;
    }
  }
  return picked;
};
