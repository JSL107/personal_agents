import { JobSourceId } from '../domain/job-feed.type';

// 429 는 재시도 대상, 401/403/404 는 즉시 실패 — 호출부가 구분하려면 타입이 나뉘어야 한다.
export class JobFeedRateLimitError extends Error {
  constructor(readonly source: JobSourceId) {
    super(`${source} 요청 한도를 초과했습니다.`);
    this.name = 'JobFeedRateLimitError';
  }
}
