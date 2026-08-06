import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const main = async (): Promise<void> => {
  const outcomes = await prisma.alertOutcome.findMany({
    orderBy: { evaluatedAt: 'desc' },
    select: {
      alertId: true,
      horizonDays: true,
      firedPrice: true,
      horizonPrice: true,
      returnPct: true,
      evaluatedAt: true,
      alert: {
        select: {
          tradeDate: true,
          ruleId: true,
          ticker: {
            // 전환 전 기록은 tossSymbol 이 없고 yahooSymbol 만 있다. 과거 기록의 심볼을
            // 잃지 않도록 둘 다 조회한다.
            select: { name: true, tossSymbol: true, yahooSymbol: true },
          },
        },
      },
    },
  });

  console.table(
    outcomes.map((outcome) => ({
      alertId: outcome.alertId,
      ticker: outcome.alert.ticker.name,
      symbol:
        outcome.alert.ticker.tossSymbol ??
        outcome.alert.ticker.yahooSymbol ??
        '-',
      ruleId: outcome.alert.ruleId,
      tradeDate: outcome.alert.tradeDate.toISOString().slice(0, 10),
      horizonDays: outcome.horizonDays,
      firedPrice: outcome.firedPrice.toString(),
      horizonPrice: outcome.horizonPrice.toString(),
      returnPct: outcome.returnPct.toString(),
      evaluatedAt: outcome.evaluatedAt.toISOString(),
    })),
  );
};

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
