import { ChangedFileStat } from '../../../github/domain/github.type';
import { ReviewFinding } from './code-reviewer.type';

export enum RiskMapLevel {
  PASS = 'pass',
  QUICK = 'quick',
  CAREFUL = 'careful',
}

export enum RiskFileRole {
  CODE = 'code',
  VIEW = 'view',
  TEST = 'test',
  SCHEMA = 'schema',
  INFRA = 'infra',
  MANIFEST = 'manifest',
  LOCKFILE = 'lockfile',
  ENV = 'env',
  CONFIG = 'config',
  DOC = 'doc',
  OTHER = 'other',
}

// 위험 지도가 읽는 PR 정보. PullRequestDetail 이 그대로 들어맞는다.
export interface RiskMapPullRequest {
  changedFiles: string[];
  changedFilesTruncated: boolean;
  changedFilesTotalCount: number;
  changedLinesByFile: Record<string, number>;
  changedFileStatsByFile?: Record<string, ChangedFileStat>;
}

export interface RiskMapDiff {
  diff: string;
  truncated: boolean;
}

export interface ComputeRiskMapInput {
  detail: RiskMapPullRequest;
  diff: RiskMapDiff;
  findings: ReviewFinding[];
}

export interface RiskItem {
  file: string | null;
  // PR 점수에 들어가는 몫(0~100점).
  points: number;
  // 파일 순위에 쓰는 이 파일만의 점수. 합계 상한을 나눠 가진 항목은 몫이 작아져도 파일 위험은 그대로라 따로 둔다.
  filePoints?: number;
  reason: string;
  // 같은 종류가 여러 줄에서 나오는 사유(억제 지시문·토큰). 파일 행에서 "×N" 으로 접는다.
  line?: number;
}

export interface RiskMapFile {
  path: string;
  role: RiskFileRole;
  points: number;
  reasons: string[];
  findingCount: number;
  mustFixCount: number;
}

export interface RiskMap {
  level: RiskMapLevel;
  score: number;
  levelReasons: string[];
  startHere: RiskMapFile[];
  // 점수가 낮아 목록에서 뺀 파일 수.
  lowCount: number;
  // 점수는 기준을 넘었지만 목록 상한 밖이라 뺀 파일 수.
  overflowCount: number;
  // 계산이 무엇을 못 봤는지. 비어 있으면 입력 전체를 봤다.
  notes: string[];
}

export interface LevelInput {
  score: number;
  secretFound: boolean;
  schemaChanged: boolean;
  infraChanged: boolean;
  filesTruncated: boolean;
  testsCut: boolean;
}

export interface LevelDecision {
  level: RiskMapLevel;
  reasons: string[];
}
