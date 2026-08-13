import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { DecimalValue } from '../domain/market-data.type';

export interface BenchmarkCloseWriteInput {
  symbol: string;
  tradeDate: Date;
  close: DecimalValue;
}

@Injectable()
export class BenchmarkPrismaRepository {
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
      rows.map((row) => {
        const close = row.close.toString();
        return this.prisma.benchmarkDailyClose.upsert({
          where: {
            symbol_tradeDate: {
              symbol: row.symbol,
              tradeDate: row.tradeDate,
            },
          },
          create: {
            symbol: row.symbol,
            tradeDate: row.tradeDate,
            close,
          },
          update: { close, fetchedAt },
        });
      }),
    );
    return rows.length;
  }
}
