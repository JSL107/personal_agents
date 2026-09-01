import { Module } from '@nestjs/common';

import { AgentRunModule } from '../agent-run/agent-run.module';
import { LoopbackOnlyGuard } from '../common/guard/loopback-only.guard';
import { LocalSessionsModule } from '../local-sessions/local-sessions.module';
import { PrReviewPublishModule } from '../pr-review-loop/pr-review-publish.module';
import { RouterModule } from '../router/router.module';
import { BuildLedgerUsecase } from './application/build-ledger.usecase';
import { BuildPresidentBriefingUsecase } from './application/build-president-briefing.usecase';
import { ConsoleReadService } from './application/console-read.service';
import { ConsoleWriteService } from './application/console-write.service';
import { PendingConsoleTurnStore } from './application/pending-console-turn.store';
import { PreconditionChainOrchestrator } from './application/precondition-chain.orchestrator';
import { SessionPollerService } from './application/session-poller.service';
import { SuggestNextWorkUsecase } from './application/suggest-next-work.usecase';
import { ConsoleController } from './interface/console.controller';
import { ConsoleReadGuard } from './interface/console-read.guard';
import { ConsoleStreamController } from './interface/console-stream.controller';
import { ConsoleWriteController } from './interface/console-write.controller';

// 콘솔 관제 모듈 — 읽기(REST) + 실시간(SSE) + 리모컨 write(지시/승인).
// read 경로는 부작용 0 이지만 ConsoleReadGuard(원격이면 토큰) 뒤에 둔다 — 스냅샷·스트림이
// 세션 경로와 워커 산출물을 실어 나른다. write 경로는 LoopbackOnlyGuard 뒤에서 기존 usecase 에 위임한다.
// FindAllOpenPreviewsUsecase·ApplyPreviewUsecase·CancelPreviewUsecase 는 PreviewGateModule.forRoot(global) 가,
// ConsoleEventBus 는 ConsoleEventBusModule(@Global) 이, IDAERI_ROUTER_PORT 는 RouterModule 이 제공한다.
@Module({
  imports: [
    AgentRunModule,
    LocalSessionsModule,
    PrReviewPublishModule,
    RouterModule,
  ],
  controllers: [
    ConsoleController,
    ConsoleStreamController,
    ConsoleWriteController,
  ],
  providers: [
    BuildLedgerUsecase,
    BuildPresidentBriefingUsecase,
    ConsoleReadService,
    ConsoleWriteService,
    ConsoleReadGuard,
    LoopbackOnlyGuard,
    PendingConsoleTurnStore,
    PreconditionChainOrchestrator,
    SessionPollerService,
    SuggestNextWorkUsecase,
  ],
})
export class ConsoleModule {}
