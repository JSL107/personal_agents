// 스냅숏 창. 릴스는 게시 뒤 24시간·3일·7일, 스토리는 24시간 뒤 지표가 사라지므로 만료 전에 한 번 찍는다.
export enum SnapshotWindow {
  AFTER_24_HOURS = 'AFTER_24_HOURS',
  AFTER_3_DAYS = 'AFTER_3_DAYS',
  AFTER_7_DAYS = 'AFTER_7_DAYS',
  STORY_BEFORE_EXPIRY = 'STORY_BEFORE_EXPIRY',
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

// 조회 5 미만처럼 숫자를 못 받은 경우와, 응답에서 채워 나갈 출발점.
export const EMPTY_INSIGHT_METRICS: InsightMetrics = {
  views: null,
  reach: null,
  likes: null,
  comments: null,
  shares: null,
  saved: null,
  totalInteractions: null,
  reposts: null,
  replies: null,
  avgWatchMs: null,
  totalWatchMs: null,
  skipRate: null,
};

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

// Prisma Json 열에 그대로 넣으려고 interface 가 아니라 type 으로 둔다(interface 는 인덱스 시그니처 타입에 대입되지 않는다).
export type ReelFirstLine = {
  subtitle: string;
  speech: string;
  gesture: string;
  react: string;
};

// 분류 규칙을 바꾸면 version 을 올린다. 리포트는 같은 version 끼리만 묶는다.
export const REEL_FEATURES_VERSION = 1;

export type ReelFeatures = {
  version: number;
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
};
