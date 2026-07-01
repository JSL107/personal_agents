import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GithubModule } from '../../github/github.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { PreferenceProfileModule } from '../../preference-profile/preference-profile.module';
import { GenerateBackendPlanUsecase } from './application/generate-backend-plan.usecase';
import { BeDispatcher } from './infrastructure/be.dispatcher';

@Module({
  imports: [
    ModelRouterModule,
    AgentRunModule,
    GithubModule,
    // 학습된 업무 선호(priorities 등)를 백엔드 플랜 생성에 주입 — PREFERENCE_PROFILE_PORT export.
    PreferenceProfileModule,
  ],
  providers: [GenerateBackendPlanUsecase, BeDispatcher],
  exports: [GenerateBackendPlanUsecase, BeDispatcher],
})
export class BeAgentModule {}
