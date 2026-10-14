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

export interface CujMentionReceiptRow {
  status: string;
  finalReplyStatus: string | null;
}

export interface CujOrderRow {
  targetTradeDate: Date | null;
}

export interface CujPreviewRow {
  kind: string;
}

export interface CujLedgerReaderPort {
  // `itemKind` 작업이 `before` 이전에 남긴 마지막 원장 시각. 발송 실패(FAILED)는 빼고, 콘솔·빈 회차의
  // SUPPRESSED 행은 넣는다.
  // 아침 브리핑이 결번 감시(LEDGER_GAP_WATCHES)에 쓴다.
  findLatestDeliveryBefore(
    itemKind: string,
    before: Date,
  ): Promise<Date | null>;
  readPrReviews(since: Date, until: Date): Promise<CujRunRow[]>;
  // 게시가 끝내 실패해 GitHub 에 안 나간 지적 수. 리뷰 실행은 게시 전에 SUCCEEDED 로 닫히므로
  // 실행 상태만 보면 이 단절이 보이지 않는다.
  countUnpostedFindings(since: Date, until: Date): Promise<number>;
  readDeliveries(since: Date, until: Date): Promise<CujDeliveryRow[]>;
  readPaperRecommendations(since: Date, until: Date): Promise<CujRunRow[]>;
  readPendingOrders(before: Date): Promise<CujOrderRow[]>;
  // 자연어 진입 전체 — 라우터가 기존 슬래시 트리거로 워커를 부르는 경우까지 포함한다.
  readMentions(since: Date, until: Date): Promise<CujRunRow[]>;
  // 멘션 수신 기록 — agent_run 이 안 생긴 채 끊긴 멘션과 게시 실패까지 본다.
  readMentionReceipts(
    since: Date,
    until: Date,
  ): Promise<CujMentionReceiptRow[]>;
  readFailedPreviews(since: Date, until: Date): Promise<CujPreviewRow[]>;
}
