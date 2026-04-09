export interface CrawlTarget {
  url: string;
}

export interface CrawlResult {
  url: string;
  status: 'SUCCESS' | 'FAILED';
  data?: unknown;
  error?: string;
}
