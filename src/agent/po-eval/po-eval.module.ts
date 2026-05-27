import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { GeneratePoEvaluationUsecase } from './application/generate-po-evaluation.usecase';
import { PoEvalDispatcher } from './infrastructure/po-eval.dispatcher';

// V3 phase P4 Evaluate — Work Reviewer / PO Shadow / Impact Reporter 의 직전 snapshot 을 LLM
// 1회로 합성. review omc:architect 권장: sub-agent module import 하지 않고 AgentRunModule 만
// 의존 (snapshot 조회로 충분, transitive dependency lock-in 회피).
@Module({
  imports: [ModelRouterModule, AgentRunModule],
  providers: [GeneratePoEvaluationUsecase, PoEvalDispatcher],
  exports: [GeneratePoEvaluationUsecase, PoEvalDispatcher],
})
export class PoEvalModule {}
