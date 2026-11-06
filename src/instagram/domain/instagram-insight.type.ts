// 스냅숏 창. 릴스는 게시 뒤 24시간·3일·7일, 스토리는 24시간 뒤 지표가 사라지므로 만료 전에 한 번 찍는다.
export enum SnapshotWindow {
  H24 = 'H24',
  D3 = 'D3',
  D7 = 'D7',
  STORY = 'STORY',
}

// 다시 시도해도 결과가 같은 실패. 이 값이 있는 행은 지표가 전부 null 이다.
export enum SnapshotError {
  NOT_ENOUGH_VIEWERS = 'NOT_ENOUGH_VIEWERS',
}

// Meta 가 응답에 넣지 않은 지표는 0 이 아니라 null 이다("returns an empty data set instead of 0").
export interface InsightMetrics {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  totalInteractions: number | null;
  reposts: number | null;
  replies: number | null;
  avgWatchMs: number | null;
  totalWatchMs: number | null;
  skipRate: number | null;
}

// 한 번 조회한 결과. 밀린 창이 여럿이면 같은 결과를 창마다 저장한다.
export interface InsightCapture {
  postId: string;
  capturedAt: Date;
  ageMinutes: number;
  metrics: InsightMetrics;
  followersCount: number | null;
  error: SnapshotError | null;
  raw: unknown;
}

export interface NewInsightSnapshot extends InsightCapture {
  snapshotWindow: SnapshotWindow;
}

export interface InsightSnapshot extends NewInsightSnapshot {
  id: string;
}

export enum FirstLineType {
  QUESTION = 'QUESTION',
  NUMBER = 'NUMBER',
  STATEMENT = 'STATEMENT',
}

export enum TitleForm {
  RESULT = 'RESULT',
  QUESTION = 'QUESTION',
  STATEMENT = 'STATEMENT',
}

export interface ReelFirstLine {
  subtitle: string;
  speech: string;
  gesture: string;
  react: string;
}

// 분류 규칙을 바꾸면 version 을 올린다. 리포트는 같은 version 끼리만 묶는다.
export const REEL_FEATURES_VERSION = 1;

export interface ReelFeatures {
  version: typeof REEL_FEATURES_VERSION;
  durationSec: number;
  segmentFields: string[];
  headlines: string[];
  titleForm: TitleForm;
  firstLine: ReelFirstLine;
  firstLineType: FirstLineType;
  lineCount: number;
  speechChars: number;
  pointCards: number;
  reacts: string[];
  gestureCounts: Record<string, number>;
  engine: string | null;
}
