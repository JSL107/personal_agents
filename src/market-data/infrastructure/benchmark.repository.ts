import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface BenchmarkCloseWriteInput {
  symbol: string;
  tradeDate: Date;
  close: Prisma.Decimal;
}

@Injectable()
export class BenchmarkRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findLatestTradeDate(symbol: string): Promise<Date | null> {
    const latest = await this.prisma.benchmarkDailyClose.findFirst({
      where: { symbol },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    return latest?.tradeDate ?? null;
  }

  async upsertCloses(rows: BenchmarkCloseWriteInput[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const fetchedAt = new Date();
    await this.prisma.$transaction(
      rows.map((row) =>
        this.prisma.benchmarkDailyClose.upsert({
          where: {
            symbol_tradeDate: {
              symbol: row.symbol,
              tradeDate: row.tradeDate,
            },
          },
          create: row,
          update: { close: row.close, fetchedAt },
        }),
      ),
    );
    return rows.length;
  }
}
