export const PORTFOLIO_SYNC_CARD_REPOSITORY_PORT = Symbol(
  'PortfolioSyncCardRepositoryPort',
);

export type PortfolioSyncCardStatus = 'PLANNED' | 'ACTIVE' | 'DETACHED';

export interface PortfolioSyncCardRow {
  slug: string;
  siteProjectId: string | null;
  repo: string;
  topicIndex: number;
  memberPrs: string[];
  coverOf: string | null;
  status: PortfolioSyncCardStatus;
  inheritPublished: boolean;
  lastSentSortOrder: number | null;
}

export interface PortfolioSyncCardAdoptionRow {
  slug: string;
  siteProjectId: string | null;
  repo: string;
  topicIndex: number;
  memberPrs: string[];
  coverOf: string | null;
}

export interface PortfolioSyncCardWrite extends PortfolioSyncCardAdoptionRow {
  lastSentSortOrder?: number | null;
}

export interface PortfolioSyncCardRepositoryPort {
  findAll(): Promise<PortfolioSyncCardRow[]>;
  upsertActive(input: PortfolioSyncCardWrite): Promise<void>;
  clearCoverOf(slugs: string[]): Promise<void>;
  createMany(rows: PortfolioSyncCardAdoptionRow[]): Promise<void>;
}
