import { Module } from '@nestjs/common';

import { BeAgentModule } from '../agent/be/be.module';
import { BeDispatcher } from '../agent/be/infrastructure/be.dispatcher';
import { BeFixModule } from '../agent/be-fix/be-fix.module';
import { BeFixDispatcher } from '../agent/be-fix/infrastructure/be-fix.dispatcher';
import { BeSchemaModule } from '../agent/be-schema/be-schema.module';
import { BeSchemaDispatcher } from '../agent/be-schema/infrastructure/be-schema.dispatcher';
import { BeSreModule } from '../agent/be-sre/be-sre.module';
import { BeSreDispatcher } from '../agent/be-sre/infrastructure/be-sre.dispatcher';
import { BeTestModule } from '../agent/be-test/be-test.module';
import { BeTestDispatcher } from '../agent/be-test/infrastructure/be-test.dispatcher';
import { CeoModule } from '../agent/ceo/ceo.module';
import { CeoDispatcher } from '../agent/ceo/infrastructure/ceo.dispatcher';
import { CodeReviewerModule } from '../agent/code-reviewer/code-reviewer.module';
import { CodeReviewerDispatcher } from '../agent/code-reviewer/infrastructure/code-reviewer.dispatcher';
import { CtoModule } from '../agent/cto/cto.module';
import { CtoDispatcher } from '../agent/cto/infrastructure/cto.dispatcher';
import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { ImpactReporterDispatcher } from '../agent/impact-reporter/infrastructure/impact-reporter.dispatcher';
import { PmDispatcher } from '../agent/pm/infrastructure/pm.dispatcher';
import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { PoEvalDispatcher } from '../agent/po-eval/infrastructure/po-eval.dispatcher';
import { PoEvalModule } from '../agent/po-eval/po-eval.module';
import { PoShadowDispatcher } from '../agent/po-shadow/infrastructure/po-shadow.dispatcher';
import { PoShadowModule } from '../agent/po-shadow/po-shadow.module';
import { WorkReviewerDispatcher } from '../agent/work-reviewer/infrastructure/work-reviewer.dispatcher';
import { WorkReviewerModule } from '../agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { ModelRouterModule } from '../model-router/model-router.module';
import { IdaeriRouterUsecase } from './application/idaeri-router.usecase';
import { IntentClassifierUsecase } from './application/intent-classifier.usecase';
import { IDAERI_ROUTER_PORT } from './domain/idaeri-router.port';
import {
  AGENT_DISPATCHER_PORT,
  AgentDispatcher,
} from './domain/port/agent-dispatcher.port';

// V3 비전 봇 쪼개기 — Hierarchical Manager Pattern 진입점.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4 / §6.1)
//
// AGENT_DISPATCHER_PORT 는 PreviewGate.forRoot 와 동일 패턴으로 한 곳 (RouterModule) 에서 useFactory
// 가 모든 dispatcher 를 inject 받아 array 로 합쳐 등록. 분산 multi-provider 는 NestJS 가 module
// 경계를 넘어 합치지 않는 동작 때문에 array 가 되지 않는다 — runtime DI 회귀의 근본 원인.
//
// 다음 plan 진입 시 추가될 메커니즘:
//   1. Slack message event handler 의 자연어 진입 (이미 step 5 에서 통합).
//   2. handoff chain (이미 step 6 / step 8 에서 통합).
@Module({
  imports: [
    ModelRouterModule,
    AgentRunModule,
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
    CtoModule,
    PoEvalModule,
    CeoModule,
  ],
  providers: [
    IntentClassifierUsecase,
    { provide: IDAERI_ROUTER_PORT, useClass: IdaeriRouterUsecase },
    {
      provide: AGENT_DISPATCHER_PORT,
      useFactory: (...resolved: AgentDispatcher[]) => resolved,
      inject: [
        PmDispatcher,
        WorkReviewerDispatcher,
        CodeReviewerDispatcher,
        ImpactReporterDispatcher,
        PoShadowDispatcher,
        BeDispatcher,
        BeSchemaDispatcher,
        BeTestDispatcher,
        BeSreDispatcher,
        BeFixDispatcher,
        CtoDispatcher,
        PoEvalDispatcher,
        CeoDispatcher,
      ],
    },
  ],
  exports: [IDAERI_ROUTER_PORT],
})
export class RouterModule {}
