export class MarketDataRateLimitError extends Error {
  constructor() {
    super('시세 조회 요청 한도를 초과했습니다.');
    this.name = 'MarketDataRateLimitError';
  }
}
