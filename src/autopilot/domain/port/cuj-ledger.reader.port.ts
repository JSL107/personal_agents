export const CUJ_LEDGER_READER_PORT = Symbol('CUJ_LEDGER_READER_PORT');

export interface CujRunRow {
  status: string;
  agentType: string;
  durationMs: number | null;
  startedAt: Date;
  output: unknown;
}

export interface CujDeliveryRow {
  status: string;
  itemKinds: string[];
  createdAt: Date;
  suppressReason: string | null;
  errorMessage: string | null;
}

export interface CujOrderRow {
  targetTradeDate: Date | null;
}

export interface CujPreviewRow {
  kind: string;
}

export interface CujLedgerReaderPort {
  readPrReviews(since: Date, until: Date): Promise<CujRunRow[]>;
  // 게시가 끝내 실패해 GitHub 에 안 나간 지적 수. 리뷰 실행은 게시 전에 SUCCEEDED 로 닫히므로
  // 실행 상태만 보면 이 단절이 보이지 않는다.
  countUnpostedFindings(since: Date, until: Date): Promise<number>;
  readDeliveries(since: Date, until: Date): Promise<CujDeliveryRow[]>;
  readPaperRecommendations(since: Date, until: Date): Promise<CujRunRow[]>;
  readPendingOrders(before: Date): Promise<CujOrderRow[]>;
  // 자연어 진입 전체 — 라우터가 기존 슬래시 트리거로 워커를 부르는 경우까지 포함한다.
  readMentions(since: Date, until: Date): Promise<CujRunRow[]>;
  readFailedPreviews(since: Date, until: Date): Promise<CujPreviewRow[]>;
}
