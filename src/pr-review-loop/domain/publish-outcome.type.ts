// 게시 결과 집계. 각 카드가 어떤 경로로 처리됐는지 센다.
export interface PublishOutcome {
  inline: number; // 줄 단위 인라인 게시 성공
  file: number; // 줄 앵커 실패 → 파일 단위 강등
  issueComment: number; // 인라인·파일 모두 실패 → 일반 코멘트 묶음
  dryRun: number; // 연습 모드 (게시 안 함)
  notPosted: number; // allowlist 밖 또는 모든 경로 실패
  dropped: number; // 게시 상한 초과
  duplicate: number; // 지문 중복 (이미 있는 카드)
}

// 스윕이 처리한 PR 1건의 결과. Slack 요약(포맷터)과 usecase 가 공유한다.
export interface SweepPullRequestResult {
  prRef: string; // "owner/repo#number"
  riskLevel: string;
  outcome: PublishOutcome;
}
