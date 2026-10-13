/**
 * 이대리 자신의 레포. 손으로 적은 레포 규약(`buildRepoConventions`)과 diff 밖 맥락
 * (`buildRelatedCode`)은 이 레포에만 붙는다 — 둘 다 이 레포 사정을 전제로 짠 것이라
 * 세대가 다른 레포에 실으면 오탐 대신 정탐을 지운다.
 */
export const SELF_REPO = 'JSL107/personal_agents';

/**
 * 기각에서 학습한 규약(`buildLearnedConventions`)이 실리는 레포. 목록은 여기 한 곳에만 둔다.
 *
 * 규약은 레포마다 다르다 — 조회가 레포별이라(`findRejectionsForConventions`) 한 레포의 기각이
 * 다른 레포에 섞이지는 않지만, 표본이 작은 레포에 열면 PR 한두 건의 사정이 레포 성향으로
 * 굳는다. 그래서 기각 이유가 충분히 쌓이고 재료를 전수로 읽어 본 레포만 넣는다.
 * `sbe-spinoff-workspace` 는 2026-10-13 에 열었다 — 30일 기각 14건, 전부 40자 이상의 반박이고
 * 수용을 기각으로 잘못 남긴 카드는 없었다.
 *
 * 남이 쓴 문장이 규약으로 굳는 경로는 레포 목록이 아니라 **수확 단계**에서 막는다 —
 * 기각 이유(`rejectReason`)에는 owner 가 쓴 답글만 저장한다(`harvest-signal.ts` 의
 * `ownerReplyBody`). PR 작성자가 다른 사람이어도 그 사람의 답글은 판정에만 쓰이고 규약
 * 재료가 되지 않는다.
 *
 * 규약을 **싣는 쪽**(code-reviewer)과 그 효과를 **재는 쪽**(채택률 집계)이 이 목록을 같이 쓴다.
 * 재는 쪽이 전 레포를 합산하면 규약이 실리지도 않는 레포의 결론이 눈금에 섞여
 * "규약을 실은 뒤 나아졌나" 에 답할 수 없다 — 실측(2026-08-26)상 ARCHITECTURE 최근 14일
 * 기각 4건 중 1건이 규약 미적용 레포(`DDD-Community/DDD_BE#86`)였다. 목록 안에서도 레포끼리
 * 합산하지 않는다.
 */
export const LEARNING_REPOS: readonly string[] = [
  SELF_REPO,
  'schoolbell-e/sbe-spinoff-workspace',
];

/** 대소문자·공백 차이를 흡수해 비교한다. GitHub 레포 이름은 대소문자를 구분하지 않는다. */
const sameRepo = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

export const isSelfRepo = (repo: string): boolean => sameRepo(repo, SELF_REPO);

export const isLearningRepo = (repo: string): boolean =>
  LEARNING_REPOS.some((learningRepo) => sameRepo(repo, learningRepo));
