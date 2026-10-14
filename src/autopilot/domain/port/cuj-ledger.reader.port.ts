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
  readDeliveries(since: Date, until: Date): Promise<CujDeliveryRow[]>;
  readPaperRecommendations(since: Date, until: Date): Promise<CujRunRow[]>;
  readPendingOrders(before: Date): Promise<CujOrderRow[]>;
  readMentions(since: Date, until: Date): Promise<CujRunRow[]>;
  readFailedPreviews(since: Date, until: Date): Promise<CujPreviewRow[]>;
}
