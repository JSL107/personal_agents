import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import {
  AGENT_DISPATCHER_PORT,
  provideAgentDispatcher,
} from '../../router/domain/port/agent-dispatcher.port';
import { SandboxModule } from '../../sandbox/sandbox.module';
import { GenerateTestUsecase } from './application/generate-test.usecase';
import { BeTestDispatcher } from './infrastructure/be-test.dispatcher';
import { JestMockGenerator } from './infrastructure/jest-mock-generator';
import { TreeSitterTestAnalyzer } from './infrastructure/tree-sitter-test-analyzer';

// V3 §8 self-correction 단계 2 (2026-05-05 plan) — sandbox tmpfs 위에 spec 검증 + retry 루프 재도입.
// MVP 의 SandboxModule 미의존 상태는 codex P1 회피 차원이었고, tmpfs 주입 (`docker-sandbox-runner.ts:25-238`) 으로
// 호스트 fs write 없이 컨테이너 in-memory 검증이 가능해진 시점에 의존 재도입.
@Module({
  imports: [AgentRunModule, ModelRouterModule, SandboxModule],
  providers: [
    GenerateTestUsecase,
    TreeSitterTestAnalyzer,
    JestMockGenerator,
    BeTestDispatcher,
    provideAgentDispatcher(BeTestDispatcher),
  ],
  exports: [GenerateTestUsecase, AGENT_DISPATCHER_PORT],
})
export class BeTestModule {}
