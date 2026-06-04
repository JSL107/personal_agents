// BE 자율 개발 Phase 2a-2 — BackendPlan → unified diff 변환 결과.
// LLM (CLAUDE) 호출 응답을 BeDiffGenerator.parse 가 검증.
export interface BeDiffGenerationResult {
  // 정확한 unified diff 텍스트 — `git apply` 가 수용하는 형식.
  // 1개 이상 file header (`--- a/...` + `+++ b/...`) + 1개 이상 hunk header (`@@`) 검증.
  diff: string;
  // LLM 이 적은 패치 의도 설명 (Slack 응답에 정성적 컨텍스트로 동봉).
  reasoning: string;
  // 변경된 파일 목록 — diff 로부터 parser 가 추출. caller 가 quick summary 에 활용.
  changedFiles: string[];
}

export interface BeDiffGenerationInput {
  // BE worker (BackendPlan / 자유 텍스트) 의 plan 본문. parser 가 그대로 prompt 에 inline.
  planText: string;
  // 대상 repo 식별자 (예: "JSL107/personal_agents"). 의미적 grounding 만 — 실제 코드 fetch X.
  repoLabel: string;
  // 베이스 브랜치 (메타데이터).
  baseBranch: string;
}
