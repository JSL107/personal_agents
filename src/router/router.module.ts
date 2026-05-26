import { Module } from '@nestjs/common';

import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { IdaeriRouterUsecase } from './application/idaeri-router.usecase';
import { IDAERI_ROUTER_PORT } from './domain/idaeri-router.port';

// V3 비전 봇 쪼개기 — Hierarchical Manager Pattern 진입점.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4 / §6.1)
//
// step 2 — Worker dispatcher registry 도입. PM 부터 wiring (PmAgentModule 의 multi-provider 가 자동
// AgentDispatcher 등록). 매니저 dispatch 가 agentType=PM 에 한해 실제 동작.
// 나머지 agent (BE / WORK_REVIEWER / CODE_REVIEWER / IMPACT_REPORTER / PO_SHADOW / BE_SCHEMA /
// BE_TEST / BE_SRE / BE_FIX) 의 dispatcher 는 follow-up step 에서 추가.
@Module({
  imports: [PmAgentModule],
  providers: [{ provide: IDAERI_ROUTER_PORT, useClass: IdaeriRouterUsecase }],
  exports: [IDAERI_ROUTER_PORT],
})
export class RouterModule {}
