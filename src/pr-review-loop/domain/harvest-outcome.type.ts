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
  /**
   * 👎 리액션과 답글 내용이 어긋나 확정을 보류한 카드 수.
   *
   * 리액션 오조작으로 수용한 지적이 기각으로 적재되면 그 답글이 다음 리뷰의 레포 규약이
   * 되어 좋은 지적을 억제한다(실제 사고: 카드 57). 확정하지 않고 사람에게 넘긴다.
   */
  contradicted: number;
  // 이번 회차 카운트가 아니라 "지금까지의 누적 채택률"이다. 카드 상태가 바뀐 회차에만
  // 채워진다 — 상태가 그대로면 비율도 그대로이므로 조회 자체를 하지 않는다.
  adoption: CategoryAdoption[];
}
