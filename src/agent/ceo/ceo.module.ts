import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { GenerateCeoMetaUsecase } from './application/generate-ceo-meta.usecase';
import { CeoDispatcher } from './infrastructure/ceo.dispatcher';

// V3 phase P5 Meta — PO_EVAL (필수) + PM/CTO (선택) 의 직전 snapshot 합성.
// PO_EVAL module 패턴 차용 — AgentRunModule + ModelRouterModule 만 의존 (phase module 의존 X).
// minimal 단계 — 컨텍스트 오염 알고리즘은 별도 R&D plan.
@Module({
  imports: [ModelRouterModule, AgentRunModule],
  providers: [GenerateCeoMetaUsecase, CeoDispatcher],
  exports: [GenerateCeoMetaUsecase, CeoDispatcher],
})
export class CeoModule {}
