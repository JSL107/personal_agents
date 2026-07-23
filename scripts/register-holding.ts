import { PrismaClient } from '@prisma/client';

import { YahooFinanceMarketDataClient } from '../src/market-data/infrastructure/yahoo-finance.market-data.client';

// 사용법: pnpm exec ts-node scripts/register-holding.ts 005930.KS 68200 10
// 국내는 접미사(.KS/.KQ)를 붙이고, 미국은 Yahoo 심볼(AAPL)을 그대로 쓴다.
// 등록 전에 조회해 종목명을 사람이 확인한다.
const main = async (): Promise<void> => {
  const [yahooSymbol, avgPriceRaw, quantityRaw] = process.argv.slice(2);
  if (!yahooSymbol || !avgPriceRaw || !quantityRaw) {
    console.error(
      '사용법: ts-node scripts/register-holding.ts <심볼> <평단> <수량>\n국내 예: ts-node scripts/register-holding.ts 005930.KS 68200 10\n미국 예: ts-node scripts/register-holding.ts AAPL 210.50 3',
    );
    process.exit(1);
  }

  const client = new YahooFinanceMarketDataClient();
  const instrument = await client.resolveSymbol(yahooSymbol);
  if (!instrument) {
    console.error(
      `[거부] ${yahooSymbol} 를 확인할 수 없습니다. 국내 접미사(.KS/.KQ) 또는 미국 Yahoo 심볼을 확인하세요.`,
    );
    process.exit(1);
  }

  console.log(
    `확인 — ${instrument.name} (${instrument.market}, ${instrument.currency})`,
  );
  const marketCountry =
    instrument.market === 'NASDAQ' || instrument.market === 'NYSE'
      ? 'US'
      : 'KR';

  const prisma = new PrismaClient();
  try {
    const ticker = await prisma.ticker.upsert({
      where: {
        market_code: { market: instrument.market, code: instrument.code },
      },
      create: {
        code: instrument.code,
        market: instrument.market,
        marketCountry,
        yahooSymbol: instrument.yahooSymbol,
        name: instrument.name,
        currency: instrument.currency,
      },
      update: {
        marketCountry,
        yahooSymbol: instrument.yahooSymbol,
        name: instrument.name,
        currency: instrument.currency,
      },
    });

    const effectiveDate = new Date();
    effectiveDate.setUTCHours(0, 0, 0, 0);
    await prisma.holding.upsert({
      where: {
        tickerId_effectiveDate: { tickerId: ticker.id, effectiveDate },
      },
      create: {
        tickerId: ticker.id,
        quantity: quantityRaw,
        avgPrice: avgPriceRaw,
        currency: instrument.currency,
        effectiveDate,
      },
      update: { quantity: quantityRaw, avgPrice: avgPriceRaw },
    });

    console.log(
      `등록 완료 — ${instrument.name} 평단 ${avgPriceRaw} × ${quantityRaw}주`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

void main();
