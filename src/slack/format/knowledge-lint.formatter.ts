import { KnowledgeLintIssue } from '../../episodic-memory/domain/port/knowledge-lint.port';

// Knowledge-Lint 이슈 → Slack mrkdwn. LLM 없이 순수 포맷.
// 에피소드 id/distance(숫자)만 노출 — content 본문을 싣지 않으므로 mrkdwn escape 불필요.
export const formatKnowledgeLint = (
  issues: KnowledgeLintIssue[],
  firedAtKst: string,
): string => {
  const duplicates = issues.filter((issue) => issue.type === 'near_duplicate');
  const nulls = issues.filter((issue) => issue.type === 'embedding_null');

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

  return sections.join('\n');
};
