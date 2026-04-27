import { Inject, Injectable } from '@nestjs/common';

import {
  AGENT_RUN_REPOSITORY_PORT,
  AgentRunRepositoryPort,
  QuotaStatRow,
} from '../domain/port/agent-run.repository.port';

const DAY_MS = 24 * 60 * 60 * 1000;

export type QuotaRange = 'TODAY' | 'WEEK';

export interface QuotaStatsResult {
  range: QuotaRange;
  // 사용자에게 보이는 시작 시각 (UTC ISO).
  sinceIso: string;
  rows: QuotaStatRow[];
  totals: {
    count: number;
    totalDurationMs: number;
  };
}

// OPS-1 Cost / Quota Observability Pane.
// 슬랙 사용자가 자기 자신의 agent_run 사용량 (provider 별 호출 수 / 평균 duration / 총 duration)
// 을 즉시 확인할 수 있게 한다. quota 절대 limit 은 codex/claude CLI 가 노출 안 하므로
// 추정값 대신 raw 사용량만 노출 — 사용자가 polling 으로 자기 환경의 quota 소진 추세를 파악.
@Injectable()
export class GetQuotaStatsUsecase {
  constructor(
    @Inject(AGENT_RUN_REPOSITORY_PORT)
    private readonly repository: AgentRunRepositoryPort,
  ) {}

  async execute({
    slackUserId,
    range,
    now = new Date(),
  }: {
    slackUserId: string;
    range: QuotaRange;
    now?: Date;
  }): Promise<QuotaStatsResult> {
    const sinceMs =
      range === 'TODAY' ? now.getTime() - DAY_MS : now.getTime() - 7 * DAY_MS;
    const since = new Date(sinceMs);

    const rows = await this.repository.aggregateQuotaStats({
      slackUserId,
      since,
    });

    const totals = rows.reduce(
      (acc, row) => ({
        count: acc.count + row.count,
        totalDurationMs: acc.totalDurationMs + row.totalDurationMs,
      }),
      { count: 0, totalDurationMs: 0 },
    );

    return {
      range,
      sinceIso: since.toISOString(),
      rows,
      totals,
    };
  }
}
