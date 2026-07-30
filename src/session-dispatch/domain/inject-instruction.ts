// 자동 분배로 세션에 주입할 지시문. 세션의 에이전트가 그대로 수행할 수 있게 자기완결형으로.
export function injectInstructionForPr(prRef: string): string {
  return `열린 PR ${prRef} 를 리뷰해 줘. 변경 파일을 확인하고, 버그·설계·테스트 관점의 개선점을 정리한 뒤 필요한 수정을 제안해 줘.`;
}

export interface CiFailureInstructionParams {
  readonly repo: string;
  readonly checkName: string;
  readonly headSha: string;
  readonly htmlUrl: string;
}

// CI 체크 실패를 세션이 그대로 수정할 수 있게 자기완결형으로.
export function injectInstructionForCiFailure(
  params: CiFailureInstructionParams,
): string {
  const { repo, checkName, headSha, htmlUrl } = params;
  const shortSha = headSha.slice(0, 7);
  return `저장소 ${repo}의 커밋 ${shortSha}에서 CI 체크 "${checkName}"가 실패했어. 로컬에서 실패를 재현하고 원인을 파악한 뒤 수정해 줘. 실패 상세: ${htmlUrl}`;
}
