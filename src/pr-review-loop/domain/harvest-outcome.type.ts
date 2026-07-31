export interface HarvestOutcome {
  acked: number;
  rejected: number;
  stale: number;
  resolved: number;
  judged: number;
  skipped: number;
}
