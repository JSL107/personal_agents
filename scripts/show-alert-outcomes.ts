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
            select: { name: true, yahooSymbol: true },
          },
        },
      },
    },
  });

  console.table(
    outcomes.map((outcome) => ({
      alertId: outcome.alertId,
      ticker: outcome.alert.ticker.name,
      yahooSymbol: outcome.alert.ticker.yahooSymbol ?? '-',
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
