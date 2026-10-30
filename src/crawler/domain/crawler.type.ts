export interface CrawlTarget {
  url: string;
}

export interface CrawlSuccessResult {
  url: string;
  status: 'SUCCESS';
  data: ParsedPage;
}

export interface CrawledPage {
  requestedUrl: string;
  finalUrl: string;
  html: string;
  responseStatus: number | null;
}

export interface ParsedPage {
  title: string;
  description: string;
}
