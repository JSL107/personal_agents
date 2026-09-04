import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ScreeningScorecardRow } from '../domain/screening-scorecard';

const ITEM_WRITE_CHUNK_SIZE = 200;

export interface ScreeningRunItemInput {
  tickerId: number;
  rank: number;
  score: number;
  // 그날 프롬프트에 실렸는가. 통과 전체를 남기므로 이 값 없이는 "보고도 안 산 것" 과
  // "보여준 적조차 없는 것" 이 한 덩어리가 된다.
  presented: boolean;
  // 레포 관례상 Json 컬럼 입력은 unknown 으로 받고 저장 직전에 좁힌다
  // (paper_order.indicatorSnapshot 과 같은 형태).
  indicatorSnapshot: unknown;
}

export interface SaveScreeningRunInput {
  strategy: string;
  asOf: Date;
  ruleVersion: number;
  // 이 회차를 만든 추천 실행. CLI 로 사람이 확인차 돌린 회차는 null 이다.
  agentRunId: number | null;
  universeCount: number;
  evaluatedCount: number;
  staleCount: number;
  passedCount: number;
  items: ScreeningRunItemInput[];
}

export type SaveScreeningRunOutcome =
  | { saved: true; runId: number; recordedCount: number }
  // 운영 회차가 이미 있어 남기지 않은 경우. 조용히 성공으로 돌리면 호출자가
  // "남았다" 로 오해하므로 이유와 기존 회차를 함께 돌려준다.
  | { saved: false; reason: 'OPERATIONAL_RUN_EXISTS'; runId: number };

export interface UnscoredScreeningItem {
  itemId: number;
  tickerId: number;
}

export interface UnscoredScreeningRun {
  runId: number;
  strategy: string;
  asOf: Date;
  items: UnscoredScreeningItem[];
}

export interface ScreeningOutcomeBarRow {
  tickerId: number;
  tradeDate: Date;
  open: Prisma.Decimal | null;
  close: Prisma.Decimal;
}

export interface SaveScreeningItemOutcomeInput {
  itemId: number;
  horizonDays: number;
  entryTradeDate: Date;
  entryPrice: string;
  horizonTradeDate: Date;
  horizonPrice: string;
  returnPct: string;
}

// 조회 상한을 달력으로 두지 않는다. 지평은 저장된 봉의 수로 세는데 달력으로 자르면
// 스크리닝 직후 오래 거래정지됐다 재개된 종목이 봉을 다 채우고도 잘려 나가, 영영
// 미도래로 남는다. 미채점 회차만 조회하므로 범위를 열어 두어도 회차당 종목 수만큼이다.

// 전략·기준일·종목 세 값으로 매수 여부를 가른다. 기준일은 `@db.Date` 라 UTC 자정으로
// 오므로 날짜 문자열로 좁혀 시각 성분이 키에 섞이지 않게 한다.
const toBoughtKey = (
  strategy: string,
  dataAsOf: Date,
  tickerId: number,
): string => `${strategy}|${dataAsOf.toISOString().slice(0, 10)}|${tickerId}`;

@Injectable()
export class ScreeningHistoryPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 같은 기준일을 다시 돌리면 항목까지 통째로 갈아 끼운다. 남겨 두면 상한을 줄여 다시
  // 돌린 회차에 옛 항목이 섞여, 그날 무엇을 보여줬는지가 실제와 달라진다.
  async saveScreeningRun(
    input: SaveScreeningRunInput,
  ): Promise<SaveScreeningRunOutcome> {
    const header = {
      ruleVersion: input.ruleVersion,
      agentRunId: input.agentRunId,
      universeCount: input.universeCount,
      evaluatedCount: input.evaluatedCount,
      staleCount: input.staleCount,
      passedCount: input.passedCount,
    };
    return await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.screeningRun.findUnique({
        where: {
          strategy_asOf: { strategy: input.strategy, asOf: input.asOf },
        },
        select: { id: true, agentRunId: true },
      });
      // 운영 회차는 확인차 돌린 CLI 실행에 자리를 내주지 않는다. 상한이 다른 실행이
      // 항목을 갈아버리면 그날 모델에게 무엇을 보여줬는지가 비가역적으로 사라진다.
      // 운영이 운영을 덮어쓰는 것은 허용 — 같은 기준일 재실행은 정본 갱신이다.
      if (
        existing !== null &&
        existing.agentRunId !== null &&
        input.agentRunId === null
      ) {
        return {
          saved: false as const,
          reason: 'OPERATIONAL_RUN_EXISTS' as const,
          runId: existing.id,
        };
      }
      const run = await transaction.screeningRun.upsert({
        where: {
          strategy_asOf: { strategy: input.strategy, asOf: input.asOf },
        },
        create: { strategy: input.strategy, asOf: input.asOf, ...header },
        update: header,
        select: { id: true },
      });
      await transaction.screeningRunItem.deleteMany({
        where: { runId: run.id },
      });
      for (
        let offset = 0;
        offset < input.items.length;
        offset += ITEM_WRITE_CHUNK_SIZE
      ) {
        await transaction.screeningRunItem.createMany({
          data: input.items
            .slice(offset, offset + ITEM_WRITE_CHUNK_SIZE)
            .map((item) => ({
              runId: run.id,
              tickerId: item.tickerId,
              rank: item.rank,
              score: item.score,
              presented: item.presented,
              indicatorSnapshot:
                item.indicatorSnapshot as Prisma.InputJsonValue,
            })),
        });
      }
      return {
        saved: true as const,
        runId: run.id,
        recordedCount: input.items.length,
      };
    });
  }

  // 아직 그 지평으로 재지 않은 항목을 회차 단위로 묶어 낸다. 같은 회차는 기준일이 같아
  // 봉 조회를 한 번으로 묶을 수 있다.
  //
  // 실행이 성공한 회차만 대상이다. 회차는 모델 호출보다 먼저 확정되므로, 쿼터 소진처럼
  // 추천이 실패한 날은 회차만 남고 주문이 없다 — 그대로 채점하면 실린 종목 전부가
  // "보고도 안 샀다" 로 집계돼 대조군이 오염된다. CLI 로 확인차 돌린 회차(agentRunId 없음)도
  // 같은 이유로 제외된다.
  async findUnscoredRuns(horizonDays: number): Promise<UnscoredScreeningRun[]> {
    const items = await this.prisma.screeningRunItem.findMany({
      where: {
        outcomes: { none: { horizonDays } },
        run: { agentRun: { status: 'SUCCEEDED' } },
      },
      select: {
        id: true,
        tickerId: true,
        run: { select: { id: true, strategy: true, asOf: true } },
      },
      orderBy: [{ runId: 'asc' }, { rank: 'asc' }],
    });

    const runsById = new Map<number, UnscoredScreeningRun>();
    for (const item of items) {
      const found = runsById.get(item.run.id) ?? {
        runId: item.run.id,
        strategy: item.run.strategy,
        asOf: item.run.asOf,
        items: [],
      };
      found.items.push({ itemId: item.id, tickerId: item.tickerId });
      runsById.set(item.run.id, found);
    }
    return [...runsById.values()];
  }

  async findBarsAfter(
    tickerIds: number[],
    asOf: Date,
  ): Promise<ScreeningOutcomeBarRow[]> {
    if (tickerIds.length === 0) {
      return [];
    }
    return await this.prisma.dailyPrice.findMany({
      where: {
        tickerId: { in: tickerIds },
        tradeDate: { gt: asOf },
      },
      select: {
        tickerId: true,
        tradeDate: true,
        open: true,
        close: true,
      },
      orderBy: [{ tradeDate: 'asc' }, { id: 'asc' }],
    });
  }

  // 같은 (항목, 지평) 을 두 번 저장해도 안전하도록 upsert 로 둔다 — 한 회차 안에서
  // 재실행되거나 저장이 중간에 끊긴 경우를 위한 방어다.
  //
  // ⚠️ **이 update 분기는 평상시 채점 경로에서는 실행되지 않는다.** 채점 대상을
  // `outcomes: { none: { horizonDays } }` 로 뽑기 때문에 이미 저장된 항목은 다시 오지
  // 않는다. 즉 시세가 뒤늦게 보정돼도 저장된 성적은 그대로다. 소급 재채점이 필요해지면
  // 대상 조회부터 바꿔야 한다(가격 갱신 시각 비교 등) — 지금은 지원하지 않는다.
  async saveScreeningItemOutcomes(
    rows: SaveScreeningItemOutcomeInput[],
  ): Promise<number> {
    for (const row of rows) {
      await this.prisma.screeningItemOutcome.upsert({
        where: {
          itemId_horizonDays: {
            itemId: row.itemId,
            horizonDays: row.horizonDays,
          },
        },
        create: row,
        update: {
          entryTradeDate: row.entryTradeDate,
          entryPrice: row.entryPrice,
          horizonTradeDate: row.horizonTradeDate,
          horizonPrice: row.horizonPrice,
          returnPct: row.returnPct,
          evaluatedAt: new Date(),
        },
      });
    }
    return rows.length;
  }

  // 성적 카드용 행. 산 것과 안 산 것을 가르는 조인이 여기 있다.
  //
  // Prisma 로는 `screening_run_item` 과 `paper_order` 를 직접 조인할 수 없다 — 둘 사이에
  // 관계가 없다(한쪽은 그날 보여준 목록, 다른 쪽은 주문 원장이다). 그래서 매수 주문의
  // `전략|기준일|종목` 키를 따로 뽑아 메모리에서 맞춘다. 매수는 하루 몇 건이라 이 조회가
  // 무거워지지 않는다.
  //
  // 실행이 성공한 회차만 대상이다. 추천이 실패한 날은 회차만 남고 주문이 없어, 그대로
  // 세면 실린 종목 전부가 "보고도 안 샀다" 로 집계돼 대조군이 오염된다
  // (findUnscoredRuns 와 같은 이유·같은 조건).
  async findScorecardRows(
    horizonDays: number,
  ): Promise<ScreeningScorecardRow[]> {
    const outcomes = await this.prisma.screeningItemOutcome.findMany({
      where: {
        horizonDays,
        item: { run: { agentRun: { status: 'SUCCEEDED' } } },
      },
      select: {
        returnPct: true,
        item: {
          select: {
            rank: true,
            presented: true,
            tickerId: true,
            ticker: { select: { code: true, name: true } },
            run: { select: { strategy: true, asOf: true, ruleVersion: true } },
          },
        },
      },
    });
    if (outcomes.length === 0) {
      return [];
    }

    // 기준일을 목록이 아니라 범위로 좁힌다. 목록으로 넣으면 거래일이 쌓이는 만큼 IN 절이
    // 길어지고(1년 약 250개), 범위는 그렇지 않다. 회차가 없는 날의 주문이 섞여 들어올 수
    // 있지만 키가 `전략|기준일|종목` 이라 매칭되지 않으므로 판정에는 영향이 없다.
    const asOfTimes = outcomes.map((row) => row.item.run.asOf.getTime());
    const orders = await this.prisma.paperOrder.findMany({
      where: {
        side: 'BUY',
        dataAsOf: {
          gte: new Date(Math.min(...asOfTimes)),
          lte: new Date(Math.max(...asOfTimes)),
        },
      },
      // 계좌도 주문 상태도 가리지 않는다. 이 축이 재는 것은 "모델이 골랐나" 이고,
      // 진입가가 양쪽 다 다음 거래일 시가로 통일돼 있어 체결 여부가 성적에 안 들어간다
      // (`screening_item_outcome.entry_price` 주석). 상태로 걸러 미체결을 "안 골랐다" 로
      // 옮기면 모델 선택이 아니라 체결 운을 재게 된다.
      select: { strategy: true, dataAsOf: true, tickerId: true },
    });
    const boughtKeys = new Set(
      orders.map((order) =>
        toBoughtKey(order.strategy, order.dataAsOf, order.tickerId),
      ),
    );

    return outcomes.map((row) => ({
      strategy: row.item.run.strategy,
      ruleVersion: row.item.run.ruleVersion,
      rank: row.item.rank,
      presented: row.item.presented,
      returnPct: Number(row.returnPct),
      bought: boughtKeys.has(
        toBoughtKey(
          row.item.run.strategy,
          row.item.run.asOf,
          row.item.tickerId,
        ),
      ),
      tickerCode: row.item.ticker.code,
      tickerName: row.item.ticker.name,
    }));
  }

  // 그 지평으로 이 창 안에서 판정된 건수. 누적 표가 그대로여도 표본이 늘고 있는지를
  // 이 값으로 안다.
  //
  // 창은 `[since, until)` 로 닫는다. 위를 열어 두면 회차마다 창이 겹쳐 같은 판정이 두 주에
  // 걸쳐 세어지고, "신규" 가 실제 증가량과 달라진다.
  async countScoredBetween(
    horizonDays: number,
    since: Date,
    until: Date,
  ): Promise<number> {
    return await this.prisma.screeningItemOutcome.count({
      where: {
        horizonDays,
        evaluatedAt: { gte: since, lt: until },
        item: { run: { agentRun: { status: 'SUCCEEDED' } } },
      },
    });
  }

  // 그 지평으로 아직 채점되지 않은 회차 수. 표본이 0 일 때 "아직 안 왔다" 와 "채점이
  // 고장났다" 를 가르는 유일한 단서라, 표본 없는 지평도 이 수를 함께 적는다.
  async countRunsPendingOutcome(horizonDays: number): Promise<number> {
    return await this.prisma.screeningRun.count({
      where: {
        agentRun: { status: 'SUCCEEDED' },
        items: { some: { outcomes: { none: { horizonDays } } } },
      },
    });
  }
}
