export interface ForbiddenHit {
  term: string;
  kind: 'term' | 'pattern';
  excerpt: string;
}

const EXCERPT_RADIUS = 30;
const STRUCTURAL_PATTERNS: Array<{ term: string; expression: RegExp }> = [
  {
    term: '기관명',
    expression:
      /[가-힣A-Za-z0-9]+(?:초등학교|중학교|고등학교|여고|여중|유치원|교육청)/g,
  },
  { term: 'mig_prep_', expression: /\bmig_prep_\w+/gi },
  {
    term: '소스 파일명',
    expression: /\b[A-Za-z][\w.]*\.(?:php|blade\.php)\b/g,
  },
  { term: 'v4/v5', expression: /(?<![\w가-힣])v[45](?![\w.])/gi },
  // 사내 포인트 금액 표기 — 사고 규모(초과 지급 100,000P 등)가 정성 표현으로 안 바뀌고 남는 경우.
  { term: '포인트 금액', expression: /\d{1,3}(?:,\d{3})+\s*P\b/gi },
  // 외부 저장소의 PR·이슈 링크 — PR 기반 회고는 본문 끝에 "근거 PR" 링크가 붙어 사내 저장소명·
  // PR 번호가 그대로 남는다(실측: github.com/<org>/sbe-api-*/pull/261).
  //
  // 왜 저장소 루트까지 막지 않는가 — 본인 저장소만 허용하는 화이트리스트로 두었더니 남의 공개
  // 저장소를 인용한 글이 통째로 막혔다. 기술 글은 남의 저장소를 링크하는 것이 정상이라 이 규칙은
  // 예외가 아니라 상시 차단으로 작동했다(실측: 2026-08-29 run 1746 이 agentclientprotocol/
  // agent-client-protocol 로, 08-30 run 1767 이 ArcadeAI/arcade-vercel-ai-template 로 막혀
  // 이틀치 발행이 나가지 못했다. 원장에는 SUCCEEDED 로 남아 실패율로도 보이지 않는다).
  //
  // 새는 자리는 사내 저장소의 **루트 링크**다. 그건 조직명·저장소명이 `BLOG_MASK_FORBIDDEN_TERMS`
  // 의 낱말 스캔에 걸려야 한다 — 이 구조 패턴이 그 목록을 대신할 수는 없다.
  {
    term: '외부 저장소 PR·이슈 링크',
    expression:
      /github\.com\/(?!JSL107\/)[\w.-]+\/[\w.-]+\/(?:pull|issues|commit)\/\S+/gi,
  },
  // 사내 저장소 링크 — 위 규칙은 경로가 붙은 링크만 잡으므로 저장소 루트(`github.com/<org>/sbe-api-v4`)
  // 가 통과한다. 조직명·저장소명이 `BLOG_MASK_FORBIDDEN_TERMS` 에 들어 있으면 낱말 스캔이 잡지만,
  // 그 목록은 운영 설정이라 코드가 보장하지 못한다. 실측된 사내 저장소 접두사만이라도 경로와
  // 무관하게 막아 둔다(리뷰 지적 반영).
  {
    term: '사내 저장소 링크',
    expression: /github\.com\/[\w.-]+\/sbe[\w.-]*/gi,
  },
];

export const scanForbiddenTerms = (
  input: { body: string; tags: string[] },
  terms: string[],
): ForbiddenHit[] => {
  const hits: ForbiddenHit[] = [];
  const sources = [input.body, ...input.tags];
  const configuredTerms = normalizeTerms(terms);

  for (const source of sources) {
    for (const term of configuredTerms) {
      appendMatches(
        hits,
        source,
        new RegExp(escapeRegExp(term), 'gi'),
        term,
        'term',
      );
    }
    for (const pattern of STRUCTURAL_PATTERNS) {
      appendMatches(hits, source, pattern.expression, pattern.term, 'pattern');
    }
  }

  return hits;
};

const normalizeTerms = (terms: string[]): string[] => {
  const normalizedTerms: string[] = [];
  const seenTerms = new Set<string>();

  for (const rawTerm of terms) {
    const term = rawTerm.trim();
    const key = term.toLowerCase();
    if (term.length > 0 && !seenTerms.has(key)) {
      normalizedTerms.push(term);
      seenTerms.add(key);
    }
  }

  return normalizedTerms;
};

const appendMatches = (
  hits: ForbiddenHit[],
  source: string,
  expression: RegExp,
  term: string,
  kind: ForbiddenHit['kind'],
): void => {
  for (const match of source.matchAll(expression)) {
    const matchedTerm = kind === 'pattern' ? match[0] : term;
    hits.push({
      term: matchedTerm,
      kind,
      excerpt: buildExcerpt(source, match.index ?? 0, match[0].length),
    });
  }
};

const buildExcerpt = (source: string, index: number, length: number): string =>
  source.slice(
    Math.max(0, index - EXCERPT_RADIUS),
    Math.min(source.length, index + length + EXCERPT_RADIUS),
  );

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
