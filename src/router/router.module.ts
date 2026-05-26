import { Module } from '@nestjs/common';

import { IdaeriRouterUsecase } from './application/idaeri-router.usecase';
import { IDAERI_ROUTER_PORT } from './domain/idaeri-router.port';

// V3 비전 봇 쪼개기 — Hierarchical Manager Pattern 진입점.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4 / §6.1)
//
// 본 모듈은 scaffold — IdaeriRouterPort 와 그 skeleton 구현체만 등록. dispatch() 는 의도적으로
// 모든 호출에 대해 throw 하며, 다음 plan 진입 시 worker dispatcher registry + intent classifier 가
// 추가되면 실제 라우팅이 활성화된다.
@Module({
  providers: [{ provide: IDAERI_ROUTER_PORT, useClass: IdaeriRouterUsecase }],
  exports: [IDAERI_ROUTER_PORT],
})
export class RouterModule {}
