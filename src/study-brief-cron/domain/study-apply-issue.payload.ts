export interface StudyApplyIssuePayload {
  studyBriefId: number;
  repo: string;
  title: string;
  body: string;
}

// "owner/repo". 카드를 만들 때(env 검사)와 ✅ 적용 때(payload 검사) 같은 규칙을 쓴다 — 한쪽만
// 검사하면 잘못된 env 로 만든 카드가 승인 뒤에야 실패한다.
export const GITHUB_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export const isStudyApplyIssuePayload = (
  value: unknown,
): value is StudyApplyIssuePayload => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.studyBriefId === 'number' &&
    typeof record.repo === 'string' &&
    GITHUB_REPO_PATTERN.test(record.repo) &&
    typeof record.title === 'string' &&
    typeof record.body === 'string'
  );
};
