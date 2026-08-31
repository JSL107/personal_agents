import {
  ContradictionLintOutcome,
  KnowledgeLintOutcome,
} from '../../episodic-memory/domain/port/knowledge-lint.port';

// Knowledge-Lint 이슈 → Slack mrkdwn.
// L1/L2 는 id/distance(숫자)만 노출. L4 contradiction 의 reason 은 LLM 출력이라
// mrkdwn 제어문자(*_~`)를 제거(sanitizeMrkdwn) 해 메시지 깨짐을 막는다.
const sanitizeMrkdwn = (text: string): string => text.replace(/[*_~`]/g, '');

// L4 를 끝까지 못 돌렸나 — 쿼터 중단이거나 후보 중 일부만 판정한 경우.
// 이때는 "이상 없음" 이 성립하지 않는다: 안 본 쌍에 모순이 있을 수 있다.
const isL4Incomplete = (l4: ContradictionLintOutcome | null): boolean =>
  l4 !== null && (l4.abortedByQuota || l4.judged < l4.candidates);

// 실제로 무엇을 점검했는지 — env 플래그가 아니라 실행 결과에서 만든다.
const describeScope = (l4: ContradictionLintOutcome | null): string => {
  if (l4 === null) {
    return '중복·임베딩 점검 · 모순 판정 꺼짐';
  }
  if (l4.abortedByQuota) {
    return `중복·임베딩 점검 · 모순 ${l4.judged}/${l4.candidates}쌍만 판정 (쿼터 소진으로 중단)`;
  }
  if (l4.judged < l4.candidates) {
    return `중복·임베딩 점검 · 모순 ${l4.judged}/${l4.candidates}쌍만 판정 (일부 judge 실패)`;
  }
  return `중복·임베딩 점검 · 모순 ${l4.candidates}쌍 판정`;
};

export const formatKnowledgeLint = (
  { issues, duplicateTotal, l4 }: KnowledgeLintOutcome,
  firedAtKst: string,
): string => {
  const scope = describeScope(l4);
  const incomplete = isL4Incomplete(l4);

  // 이상 0건도 1줄 하트비트로 내보낸다 — skip 으로 끊으면 "점검했고 깨끗하다" 와 "점검이 아예
  // 안 돌았다" 가 Slack·원장 어디에도 구분되지 않는다(주 1회 발화라 사후 판정 수단이 이것뿐).
  // (선례: ops-supervisor.formatter.ts / run-retro.formatter.ts 의 조용한 계기판)
  //
  // 단 L4 를 끝까지 못 돌린 회차에는 ✅ 를 쓰지 않는다. 안 본 쌍이 남아 있는데 "이상 없음" 을
  // 알리면 점검 장애가 정상으로 위장되고, 그건 이 하트비트가 없애려던 실패 모드 그 자체다.
  if (issues.length === 0) {
    if (incomplete) {
      return `⚠️ *Knowledge Lint* — ${firedAtKst} · 모순 판정을 끝내지 못해 "이상 없음" 을 확정하지 못했습니다 (${scope})`;
    }
    return `✅ *Knowledge Lint* — ${firedAtKst} · episodic-memory 이상 없음 (${scope})`;
  }

  const duplicates = issues.filter((issue) => issue.type === 'near_duplicate');
  const nulls = issues.filter((issue) => issue.type === 'embedding_null');
  const contradictions = issues.filter(
    (issue) => issue.type === 'contradiction',
  );

  const sections: string[] = [
    `🧹 *Knowledge Lint* — ${firedAtKst} (episodic-memory 무결성)`,
  ];

  // 이슈가 있는 회차에도 L4 미완주는 알린다 — 아래 목록이 전부라고 오해하지 않게.
  if (incomplete) {
    sections.push(`⚠️ _${scope} — 아래 목록이 전부가 아닐 수 있습니다._`);
  }

  if (duplicates.length > 0) {
    // 목록은 보고 상한으로 잘린다. 잘린 사실을 적지 않으면 화면의 건수가 곧 실제 규모로
    // 읽히고, 그 오해는 아래 L4 미완주 경고가 막으려는 것과 같은 종류다.
    sections.push(
      duplicateTotal > duplicates.length
        ? `*중복 후보 ${duplicateTotal}건* _— 가까운 순 ${duplicates.length}건만 표시_`
        : `*중복 후보 ${duplicates.length}건*`,
    );
    for (const issue of duplicates) {
      sections.push(
        `• #${issue.episodeId} ↔ #${issue.relatedId} — ${issue.detail}`,
      );
    }
  }

  if (nulls.length > 0) {
    sections.push(`*임베딩 누락 ${nulls.length}건*`);
    for (const issue of nulls) {
      sections.push(`• #${issue.episodeId} — ${issue.detail}`);
    }
  }

  if (contradictions.length > 0) {
    sections.push(`⚠️ *모순 후보 ${contradictions.length}건*`);
    for (const issue of contradictions) {
      sections.push(
        `• #${issue.episodeId} ↔ #${issue.relatedId} — ${sanitizeMrkdwn(issue.detail)}`,
      );
    }
  }

  return sections.join('\n');
};
