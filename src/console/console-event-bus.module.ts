import { Global, Module } from '@nestjs/common';

import { ConsoleEventBus } from './application/console-event-bus.service';

// ConsoleEventBus 를 전역 단일 인스턴스로 제공한다.
// 발행자(agent-run 라이프사이클, preview-gate 승인)와 구독자(ConsoleStreamController)가
// 서로의 모듈을 import 하지 않고도 같은 버스를 공유하도록 @Global 로 승격 — 모듈 순환 방지.
@Global()
@Module({
  providers: [ConsoleEventBus],
  exports: [ConsoleEventBus],
})
export class ConsoleEventBusModule {}
