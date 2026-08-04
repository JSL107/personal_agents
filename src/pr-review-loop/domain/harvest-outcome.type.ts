import { CategoryAdoption } from './adoption-rate';

export interface HarvestOutcome {
  acked: number;
  rejected: number;
  // 반응 없이 후속 커밋으로 해소된 카드. 채택 쪽이므로 episodic 에 적재하지 않는다.
  fixed: number;
  stale: number;
  resolved: number;
  judged: number;
  skipped: number;
  // 이번 회차 카운트가 아니라 "지금까지의 누적 채택률"이다. 카드 상태가 바뀐 회차에만
  // 채워진다 — 상태가 그대로면 비율도 그대로이므로 조회 자체를 하지 않는다.
  adoption: CategoryAdoption[];
}
