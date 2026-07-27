import { Module } from '@nestjs/common';

import { AgentRunModule } from '../agent-run/agent-run.module';
import { ConsoleReadService } from './application/console-read.service';
import { ConsoleController } from './interface/console.controller';
import { ConsoleStreamController } from './interface/console-stream.controller';

// 콘솔 관제 모듈 — 읽기(REST) + 실시간(SSE) 표면. 부작용 0.
// FindAllOpenPreviewsUsecase 는 PreviewGateModule.forRoot(global) 가, ConsoleEventBus 는
// ConsoleEventBusModule(@Global) 이 각각 전역 export 하므로 별도 import 없이 주입된다.
@Module({
  imports: [AgentRunModule],
  controllers: [ConsoleController, ConsoleStreamController],
  providers: [ConsoleReadService],
})
export class ConsoleModule {}
