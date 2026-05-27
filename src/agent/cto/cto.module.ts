import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { GenerateAssignmentUsecase } from './application/generate-assignment.usecase';
import { CtoDispatcher } from './infrastructure/cto.dispatcher';

// V3 비전 P2 Assign — PM 의 직전 DailyPlan.assignableTaskIds 를 BE worker 3종에 분배.
// dispatcher 는 RouterModule 의 useFactory inject 에 등록 — agent module 자체는 dispatcher class
// 만 노출하면 됨 (NestJS multi-provider 의 single module scope 회피 패턴, commit cbef813 참고).
@Module({
  imports: [ModelRouterModule, AgentRunModule],
  providers: [GenerateAssignmentUsecase, CtoDispatcher],
  exports: [GenerateAssignmentUsecase, CtoDispatcher],
})
export class CtoModule {}
