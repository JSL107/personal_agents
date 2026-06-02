// repo 의 기존 label 한 건 — vocab 으로만 사용 (새 label 생성 X).
// description: octokit listLabelsForRepo 응답이 string | null 이므로 null 도 허용.
export interface RepoLabelOption {
  name: string;
  description?: string | null;
}

export interface InferIssueLabelsInput {
  // GitHub repo "owner/repo" — log/agentRun snapshot 용 (LLM 입력엔 직접 사용 X).
  repo: string;
  issueNumber: number;
  title: string;
  body: string;
  // octokit 으로 미리 fetch 한 repo label vocab. caller (consumer) 책임.
  availableLabels: RepoLabelOption[];
}

// LLM 출력 — vocab 안의 label 부분집합 + 짧은 reasoning.
// labels 는 0개일 수 있음 (어느 label 도 적합하지 않으면 빈 배열). caller 가 length=0 → skip 판단.
export interface IssueLabelInference {
  labels: string[];
  reasoning: string;
}
