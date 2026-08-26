/**
 * 리뷰 학습 루프가 적용되는 레포.
 *
 * 규약은 레포마다 다르다 — 세대가 다른 레포에 틀린 규약을 실으면 오탐 대신 정탐을 지운다.
 * 그래서 정확히 이 레포일 때만 붙인다. 다른 레포는 규약 없이(현행 그대로) 리뷰한다.
 *
 * 기각에서 학습한 규약에서는 특히 중요하다 — 기각 이유는 owner 뿐 아니라 **PR 작성자**도
 * 남길 수 있어(`harvest-review-signals.usecase.ts` 의 `decisionLogins`), 남의 레포에서는
 * 제3자가 쓴 문장이 규약으로 굳을 수 있다. owner 저장소로 한정해 그 경로를 막는다.
 *
 * 규약을 **싣는 쪽**(code-reviewer)과 그 효과를 **재는 쪽**(채택률 집계)이 같은 경계를 써야
 * 한다. 재는 쪽이 전 레포를 합산하면 규약이 실리지도 않는 레포의 결론이 눈금에 섞여
 * "규약을 실은 뒤 나아졌나" 에 답할 수 없다 — 실측(2026-08-26)상 ARCHITECTURE 최근 14일
 * 기각 4건 중 1건이 규약 미적용 레포(`DDD-Community/DDD_BE#86`)였다.
 */
export const LEARNING_REPO = 'JSL107/personal_agents';

/** 대소문자·공백 차이를 흡수해 판정한다. GitHub 레포 이름은 대소문자를 구분하지 않는다. */
export const isSelfRepo = (repo: string): boolean =>
  repo.trim().toLowerCase() === LEARNING_REPO.toLowerCase();
