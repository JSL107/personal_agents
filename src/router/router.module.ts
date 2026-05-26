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
import { ModelRouterModule } from '../model-router/model-router.module';
import { IdaeriRouterUsecase } from './application/idaeri-router.usecase';
import { IntentClassifierUsecase } from './application/intent-classifier.usecase';
import { IDAERI_ROUTER_PORT } from './domain/idaeri-router.port';

// V3 비전 봇 쪼개기 — Hierarchical Manager Pattern 진입점.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4 / §6.1)
//
// step 4 — Intent classifier 통합. 전체 10 agent dispatcher 가 등록된 상태에 더해,
// agentTypeHint 미지정 + text 있는 입력은 IntentClassifierUsecase 가 1회 LLM call 로
// 자연어 → AgentType 분류 후 dispatch.
//
// 다음 plan 진입 시 추가될 메커니즘:
//   1. Slack message event handler — 자연어 진입 surface (router 사용자 가시 활성화).
//   2. handoff chain — followUp 응답 → manager 가 cycle / depth 검증 후 재 dispatch.
@Module({
  imports: [
    ModelRouterModule,
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
  providers: [
    IntentClassifierUsecase,
    { provide: IDAERI_ROUTER_PORT, useClass: IdaeriRouterUsecase },
  ],
  exports: [IDAERI_ROUTER_PORT],
})
export class RouterModule {}
