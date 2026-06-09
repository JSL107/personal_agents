// PreviewApplier.apply 의 반환 — 사용자 메시지 + 실행 후 검증 대상 산출물(artifacts).
// 기존엔 apply 가 string(메시지)만 반환해 "API 가 throw 안 하면 성공" 으로 간주했고, 외부
// 부작용이 실제로 반영됐는지 재확인하지 않았다. ApplyResult.artifacts 는 그 재확인 대상을
// 구조화해 ResultVerifier 가 실제 반영을 재조회 검증하게 한다.
//
// 현재 검증 대상은 github_pr 만 (가장 위험한 코드 push 부작용). 코멘트/Notion 등은 검증
// 비용/한계로 후속 — artifacts 가 빈 배열이면 apply-preview 는 검증 없이 message 만 노출한다.
export type VerifiableArtifact = {
  type: 'github_pr';
  // "owner/repo"
  repo: string;
  prNumber: number;
};

export interface ApplyResult {
  // 사용자에게 노출할 Slack 메시지 (기존 apply 반환 string 과 동일 역할).
  message: string;
  // 실행 후 ResultVerifier 가 재조회로 반영을 검증할 산출물. 없으면 빈 배열.
  artifacts: VerifiableArtifact[];
}
