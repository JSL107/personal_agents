import { Module } from '@nestjs/common';

import { SandboxModule } from '../../sandbox/sandbox.module';
import { BeDiffGeneratorModule } from '../be-diff-generator/be-diff-generator.module';
import { BeSandboxApplier } from './infrastructure/be-sandbox.applier';

// Phase 2a — BE worker plan 을 sandbox 안에서 검증하는 PreviewGate strategy 의 호스트 모듈.
// Phase 2a-2 부터 BeDiffGeneratorModule 의존 (Claude 호출로 unified diff 합성).
// SandboxModule 은 Phase 2a-3 에서 git apply + pnpm test 호출 시 사용 — 현 단계는 dormant 의존성.
@Module({
  imports: [BeDiffGeneratorModule, SandboxModule],
  providers: [BeSandboxApplier],
  exports: [BeSandboxApplier],
})
export class BeSandboxModule {}
