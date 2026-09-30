import { CategoryAdoption } from './adoption-rate';

// 이번 회차에 새로 보류가 걸린 카드. 사람이 어느 스레드를 보면 되는지 Slack 에 링크로 낸다.
export interface HeldFinding {
  id: number;
  repo: string;
  pullNumber: number;
  githubCommentId: string | null;
}

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
  /**
   * `contradicted` 중 **이번 회차에 처음 보류된** 카드. 건수만 내면 어느 카드인지 몰라 사람이
   * 결론을 낼 수 없다. 이미 알린 보류(지난 회차부터 이어진 것)는 싣지 않는다.
   */
  newlyHeld: HeldFinding[];
  // 이번 회차가 모델 쿼터 소진으로 중간에 끊겼나. `skipped` 만으로는 구분되지 않는다 —
  // 변경과 안 겹쳐 판정 대상이 아니었던 카드도 같은 카운터로 세기 때문에, 값이 커도
  // "정상적으로 볼 게 없었다" 와 "못 봤다" 가 섞인다. 조용한 중단을 Slack 에 드러내는
  // 유일한 신호라 카운터가 아니라 별도 플래그로 둔다.
  quotaStopped: boolean;
  // 이번 회차 카운트가 아니라 "지금까지의 누적 채택률"이다. 카드 상태가 바뀐 회차에만
  // 채워진다 — 상태가 그대로면 비율도 그대로이므로 조회 자체를 하지 않는다.
  adoption: CategoryAdoption[];
}
