export class MarketDataSymbolNotFoundError extends Error {
  constructor(readonly symbol: string) {
    super(`시세 공급자에 없는 심볼입니다 — ${symbol}`);
    this.name = 'MarketDataSymbolNotFoundError';
  }
}
