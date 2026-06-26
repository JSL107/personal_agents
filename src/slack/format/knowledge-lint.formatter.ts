import { KnowledgeLintIssue } from '../../episodic-memory/domain/port/knowledge-lint.port';

// Knowledge-Lint 이슈 → Slack mrkdwn.
// L1/L2 는 id/distance(숫자)만 노출. L4 contradiction 의 reason 은 LLM 출력이라
// mrkdwn 제어문자(*_~`)를 제거(sanitizeMrkdwn) 해 메시지 깨짐을 막는다.
const sanitizeMrkdwn = (text: string): string => text.replace(/[*_~`]/g, '');

export const formatKnowledgeLint = (
  issues: KnowledgeLintIssue[],
  firedAtKst: string,
): string => {
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
