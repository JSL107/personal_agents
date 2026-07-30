// 자동 분배로 세션에 주입할 지시문. 세션의 에이전트가 그대로 수행할 수 있게 자기완결형으로.
export function injectInstructionForPr(prRef: string): string {
  return `열린 PR ${prRef} 를 리뷰해 줘. 변경 파일을 확인하고, 버그·설계·테스트 관점의 개선점을 정리한 뒤 필요한 수정을 제안해 줘.`;
}
