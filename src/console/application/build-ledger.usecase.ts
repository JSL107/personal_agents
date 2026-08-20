import { Inject, Injectable } from '@nestjs/common';

import {
  AGENT_RUN_REPOSITORY_PORT,
  AgentRunRepositoryPort,
} from '../../agent-run/domain/port/agent-run.repository.port';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import { buildConsoleLedger } from '../domain/ledger';
import { ConsoleLedger, LedgerClock } from '../domain/ledger.type';

@Injectable()
export class BuildLedgerUsecase {
  constructor(
    @Inject(AGENT_RUN_REPOSITORY_PORT)
    private readonly repository: AgentRunRepositoryPort,
  ) {}

  async execute(): Promise<ConsoleLedger> {
    const rows = await this.repository.findAllRunsForLedger();
    const clock: LedgerClock = {
      today: getTodayKstDate(),
      serverTime: new Date().toISOString(),
    };
    return buildConsoleLedger(rows, clock);
  }
}
