export interface HarvestOutcome {
  acked: number;
  rejected: number;
  // 반응 없이 후속 커밋으로 해소된 카드. 채택 쪽이므로 episodic 에 적재하지 않는다.
  fixed: number;
  stale: number;
  resolved: number;
  judged: number;
  skipped: number;
}
