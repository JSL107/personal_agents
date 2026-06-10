import { Module } from '@nestjs/common';

import { ModelRouterModule } from '../../model-router/model-router.module';
import { GenerateBeDiffUsecase } from './application/generate-be-diff.usecase';

// Phase 2a-2 — BackendPlan 텍스트 → unified diff LLM 호출 + 응답 파싱.
// ModelRouterModule 의 ModelRouterUsecase export 에 의존 (GenerateBeDiffUsecase 가 route() 로 호출).
@Module({
  imports: [ModelRouterModule],
  providers: [GenerateBeDiffUsecase],
  exports: [GenerateBeDiffUsecase],
})
export class BeDiffGeneratorModule {}
