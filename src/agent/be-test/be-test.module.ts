import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { GenerateTestUsecase } from './application/generate-test.usecase';
import { JestMockGenerator } from './infrastructure/jest-mock-generator';
import { TreeSitterTestAnalyzer } from './infrastructure/tree-sitter-test-analyzer';

// MVP 는 sandbox 의존을 제거 (audit codex P1 — 호스트 fs 위험 회피). spec 생성/반환만 수행.
// 향후 sandbox 디자인이 강화되면 SandboxModule 을 다시 import 해 self-correction 루프를 도입한다.
@Module({
  imports: [AgentRunModule, ModelRouterModule],
  providers: [GenerateTestUsecase, TreeSitterTestAnalyzer, JestMockGenerator],
  exports: [GenerateTestUsecase],
})
export class BeTestModule {}
