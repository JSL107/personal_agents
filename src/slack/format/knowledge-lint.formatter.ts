import { KnowledgeLintIssue } from '../../episodic-memory/domain/port/knowledge-lint.port';

// Knowledge-Lint 이슈 → Slack mrkdwn.
// L1/L2 는 id/distance(숫자)만 노출. L4 contradiction 의 reason 은 LLM 출력이라
// mrkdwn 제어문자(*_~`)를 제거(sanitizeMrkdwn) 해 메시지 깨짐을 막는다.
const sanitizeMrkdwn = (text: string): string => text.replace(/[*_~`]/g, '');

export const formatKnowledgeLint = (
  issues: KnowledgeLintIssue[],
  firedAtKst: string,
  l4Enabled: boolean,
): string => {
  // 이상 0건도 1줄 하트비트로 내보낸다 — skip 으로 끊으면 "점검했고 깨끗하다" 와 "점검이 아예
  // 안 돌았다" 가 Slack·원장 어디에도 구분되지 않는다(주 1회 발화라 사후 판정 수단이 이것뿐).
  // 점검 범위를 함께 적는 이유: L4 가 꺼진 채 나온 "이상 없음" 은 모순을 안 본 결과다.
  // (선례: ops-supervisor.formatter.ts / run-retro.formatter.ts 의 조용한 계기판)
  if (issues.length === 0) {
    const scope = l4Enabled
      ? '중복·임베딩·모순 점검'
      : '중복·임베딩 점검, 모순 판정 꺼짐';
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

  if (duplicates.length > 0) {
    sections.push(`*중복 후보 ${duplicates.length}건*`);
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
