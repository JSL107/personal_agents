import { RiskMapLevel } from './risk-map.type';

// 보정 리포트가 PR 마다 세는 신호. 뒤 둘은 아직 점수에 없는 후보라 리포트에서만 잰다.
export enum CalibrationSignal {
  SCHEMA = 'schema',
  INFRA = 'infra',
  MANIFEST = 'manifest',
  ENV = 'env',
  CONFIG = 'config',
  TEST_REMOVED = 'test-removed',
  NO_TEST_TOUCHED = 'no-test-touched',
  LARGE = 'large',
  SENSITIVE_PATH = 'sensitive-path',
  DEPENDENCY_BUMP = 'dependency-bump',
}

export interface MergedPullRequest {
  number: number;
  title: string;
  mergedAt: string;
  files: string[];
}

export interface DefectLabel {
  bad: boolean;
  // 문제 PR 로 본 근거(뒤따른 revert·fix PR). 정상이면 null.
  reason: string | null;
}

export interface LabelPullRequestsInput {
  pullRequests: MergedPullRequest[];
  windowDays: number;
}

export interface CalibrationPoint {
  repo: string;
  number: number;
  score: number;
  level: RiskMapLevel;
  signals: CalibrationSignal[];
  bad: boolean;
  reason: string | null;
}

export interface RateCell {
  n: number;
  bad: number;
  rate: number;
}

export interface ScoreRangeCell extends RateCell {
  range: string;
}

export interface SignalCell {
  signal: CalibrationSignal;
  with: RateCell;
  without: RateCell;
}

export interface SuggestedThresholds {
  quick: number | null;
  careful: number | null;
}

export interface CalibrationReport {
  total: number;
  bad: number;
  baseRate: number;
  // 문제 PR 이 정상 PR 보다 높은 점수를 받을 확률(0.5 = 가르지 못함, 1 = 완벽).
  auc: number | null;
  byLevel: Record<RiskMapLevel, RateCell>;
  byScore: ScoreRangeCell[];
  bySignal: SignalCell[];
  suggested: SuggestedThresholds;
}

export interface SignalInput {
  files: string[];
  removedFiles: string[];
  changedLines: number;
  diff: string;
}
