export enum CodeReviewerErrorCode {
  INVALID_PR_REFERENCE = 'CODE_REVIEWER_INVALID_PR_REFERENCE',
  // 링크 없는 후속 지시인데 직전 코드 리뷰 대화에 서로 다른 PR 이 여럿이라 고를 수 없는 경우.
  AMBIGUOUS_PR_REFERENCE = 'CODE_REVIEWER_AMBIGUOUS_PR_REFERENCE',
  INVALID_MODEL_OUTPUT = 'CODE_REVIEWER_INVALID_MODEL_OUTPUT',
  NO_OPEN_PR_FOUND = 'NO_OPEN_PR_FOUND',
  // 변경량이 GitHub 의 unified diff 상한을 넘어 diff 자체를 받지 못한 경우. 입력(PR)이
  // 작아지지 않는 한 몇 번을 돌려도 같은 자리에서 끊기는 **영구 실패**라, 스윕의 재시도
  // 판정(judgeLatestReview)이 이 코드를 보고 쿨다운 경로에서 제외한다.
  DIFF_TOO_LARGE = 'CODE_REVIEWER_DIFF_TOO_LARGE',
  // 상세·diff 를 다시 받아도 그 사이 push 가 이어져 같은 커밋 기준 스냅샷을 못 만든 경우.
  // 일시적이라 잠시 뒤 다시 실행하면 된다.
  PR_SNAPSHOT_MOVING = 'CODE_REVIEWER_PR_SNAPSHOT_MOVING',
}
