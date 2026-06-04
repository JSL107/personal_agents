import { Module } from '@nestjs/common';

import { SandboxModule } from '../../sandbox/sandbox.module';
import { BeDiffGeneratorModule } from '../be-diff-generator/be-diff-generator.module';
import { BeSandboxApplier } from './infrastructure/be-sandbox.applier';
import { BeSandboxPushPrApplier } from './infrastructure/be-sandbox-push-pr.applier';

// Phase 2a — BE worker plan 을 sandbox 안에서 검증하는 PreviewGate strategy 의 호스트 모듈.
// Phase 2a-2 부터 BeDiffGeneratorModule 의존 (Claude 호출로 unified diff 합성).
// Phase 2a-3b 부터 SandboxModule 적극 사용 (git apply + jest).
// Phase 2b-1 부터 BeSandboxPushPrApplier 추가 (현 단계 scaffold — octokit 호출은 Phase 2b-2).
@Module({
  imports: [BeDiffGeneratorModule, SandboxModule],
  providers: [BeSandboxApplier, BeSandboxPushPrApplier],
  exports: [BeSandboxApplier, BeSandboxPushPrApplier],
})
export class BeSandboxModule {}
