import { Module } from '@nestjs/common';

import { ModelRouterModule } from '../model-router/model-router.module';
import { FactAnswerUsecase } from './application/fact-answer.usecase';

// 워커 모듈들이 import 하는 독립 모듈. RouterModule 이 워커 모듈을 import 하므로, 이 기능을 라우터 쪽에
// 두면 워커 → 라우터 → 워커 순환 의존이 된다.
@Module({
  imports: [ModelRouterModule],
  providers: [FactAnswerUsecase],
  exports: [FactAnswerUsecase],
})
export class FactAnswerModule {}
