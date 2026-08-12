import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  CollectPricesResult,
  CollectUniversePricesUsecase,
} from '../../../screener/application/collect-universe-prices.usecase';
import {
  SyncUniverseResult,
  SyncUniverseUsecase,
} from '../../../screener/application/sync-universe.usecase';
import { formatPriceCollectionFailures } from '../../../screener/infrastructure/price-collection-failure.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

interface UniverseSweepAudit {
  sync: SyncUniverseResult;
  collection: CollectPricesResult;
}

const formatCount = (count: number): string => count.toLocaleString('en-US');

const formatSummary = (audit: UniverseSweepAudit): string => {
  const syncText = `동기화 ${formatCount(audit.sync.upserted)}건(상폐 ${formatCount(audit.sync.delisted)}건), `;
  const collection = audit.collection;
  return (
    `유니버스 스윕 완료 — ${syncText}` +
    `수집 성공 ${formatCount(collection.succeeded)}/${formatCount(collection.targetCount)}종목, ` +
    `저장 ${formatCount(collection.written)}봉, 재조정 ${formatCount(collection.readjusted)}종목, ` +
    `장중 차단 ${formatCount(collection.blockedIntraday)}봉, 실패 ${formatCount(collection.failed)}종목`
  );
};

@Injectable()
export class UniverseSweepAutopilotTask implements AutopilotTask {
  readonly id = 'universe-sweep';

  constructor(
    private readonly syncUniverse: SyncUniverseUsecase,
    private readonly collectPrices: CollectUniversePricesUsecase,
    private readonly configService: ConfigService,
    private readonly agentRunService: AgentRunService,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const enabled = this.configService.get<string>('SCREENER_ENABLED');
    if (enabled !== 'true') {
      return { skip: true };
    }

    const outcome = await this.agentRunService.execute<AutopilotTaskResult>({
      agentType: AgentType.INVEST,
      triggerType: TriggerType.AUTOPILOT_INVEST_CRON,
      inputSnapshot: {
        taskId: this.id,
        firedAtKst: context.firedAtKst,
      },
      run: async () => {
        // 최초 가동일과 장애 복구일에도 빈 유니버스를 성공 처리하지 않도록 매번 먼저 동기화한다.
        const sync = await this.syncUniverse.execute();
        const collection = await this.collectPrices.execute();
        const audit: UniverseSweepAudit = { sync, collection };
        const taskResult: AutopilotTaskResult = {
          skip: false,
          summaryText: formatSummary(audit),
          detailText:
            formatPriceCollectionFailures(
              collection.failed,
              collection.failures,
            ) ?? undefined,
        };
        return {
          result: taskResult,
          modelUsed: 'deterministic',
          output: audit,
        };
      },
    });

    return outcome.result;
  }
}
