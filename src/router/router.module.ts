import { Module } from '@nestjs/common';

import { BeAgentModule } from '../agent/be/be.module';
import { BeFixModule } from '../agent/be-fix/be-fix.module';
import { BeSchemaModule } from '../agent/be-schema/be-schema.module';
import { BeSreModule } from '../agent/be-sre/be-sre.module';
import { BeTestModule } from '../agent/be-test/be-test.module';
import { CodeReviewerModule } from '../agent/code-reviewer/code-reviewer.module';
import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { PoShadowModule } from '../agent/po-shadow/po-shadow.module';
import { WorkReviewerModule } from '../agent/work-reviewer/work-reviewer.module';
import { IdaeriRouterUsecase } from './application/idaeri-router.usecase';
import { IDAERI_ROUTER_PORT } from './domain/idaeri-router.port';

// V3 비전 봇 쪼개기 — Hierarchical Manager Pattern 진입점.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4 / §6.1)
//
// step 3 — 전체 10 agent 의 Dispatcher 를 multi-provider 패턴으로 wiring 완료.
// IdaeriRouterUsecase 가 boot 시 10개 dispatcher 를 array 로 받아 agentType → dispatcher
// 매핑 build. dispatch() 가 어떤 AgentType 으로 호출돼도 worker usecase 까지 도달.
//
// 다음 plan 진입 시 추가될 메커니즘:
//   1. intent classifier — agentTypeHint 미지정 시 자연어 → AgentType 1회 LLM 분류.
//   2. Slack message event handler — 자연어 진입 surface (router 사용자 가시 활성화).
//   3. handoff chain — followUp 응답 → manager 가 cycle / depth 검증 후 재 dispatch.
@Module({
  imports: [
    PmAgentModule,
    WorkReviewerModule,
    CodeReviewerModule,
    ImpactReporterModule,
    PoShadowModule,
    BeAgentModule,
    BeSchemaModule,
    BeTestModule,
    BeSreModule,
    BeFixModule,
  ],
  providers: [{ provide: IDAERI_ROUTER_PORT, useClass: IdaeriRouterUsecase }],
  exports: [IDAERI_ROUTER_PORT],
})
export class RouterModule {}
