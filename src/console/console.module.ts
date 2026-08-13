import { Module } from '@nestjs/common';

import { AgentRunModule } from '../agent-run/agent-run.module';
import { LocalSessionsModule } from '../local-sessions/local-sessions.module';
import { RouterModule } from '../router/router.module';
import { ConsoleReadService } from './application/console-read.service';
import { ConsoleWriteService } from './application/console-write.service';
import { PendingConsoleTurnStore } from './application/pending-console-turn.store';
import { PreconditionChainOrchestrator } from './application/precondition-chain.orchestrator';
import { SessionPollerService } from './application/session-poller.service';
import { SuggestNextWorkUsecase } from './application/suggest-next-work.usecase';
import { ConsoleController } from './interface/console.controller';
import { ConsoleStreamController } from './interface/console-stream.controller';
import { ConsoleWriteController } from './interface/console-write.controller';
import { ConsoleWriteGuard } from './interface/console-write.guard';

// 콘솔 관제 모듈 — 읽기(REST) + 실시간(SSE) + 리모컨 write(지시/승인).
// read 경로는 부작용 0. write 경로는 ConsoleWriteGuard 뒤에서 기존 usecase 에 위임한다.
// FindAllOpenPreviewsUsecase·ApplyPreviewUsecase·CancelPreviewUsecase 는 PreviewGateModule.forRoot(global) 가,
// ConsoleEventBus 는 ConsoleEventBusModule(@Global) 이, IDAERI_ROUTER_PORT 는 RouterModule 이 제공한다.
@Module({
  imports: [AgentRunModule, LocalSessionsModule, RouterModule],
  controllers: [
    ConsoleController,
    ConsoleStreamController,
    ConsoleWriteController,
  ],
  providers: [
    ConsoleReadService,
    ConsoleWriteService,
    ConsoleWriteGuard,
    PendingConsoleTurnStore,
    PreconditionChainOrchestrator,
    SessionPollerService,
    SuggestNextWorkUsecase,
  ],
})
export class ConsoleModule {}
