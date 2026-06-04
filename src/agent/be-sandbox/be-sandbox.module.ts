import { Module } from '@nestjs/common';

import { SandboxModule } from '../../sandbox/sandbox.module';
import { BeSandboxApplier } from './infrastructure/be-sandbox.applier';

// Phase 2a — BE worker plan 을 sandbox 안에서 검증하는 PreviewGate strategy 의 호스트 모듈.
// PreviewGateModule.forRoot 에 BeSandboxApplier 를 추가하기 위한 단위.
@Module({
  imports: [SandboxModule],
  providers: [BeSandboxApplier],
  exports: [BeSandboxApplier],
})
export class BeSandboxModule {}
