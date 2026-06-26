import { Module } from '@nestjs/common';

import { ModelRouterModule } from '../../model-router/model-router.module';
import { JudgeContradictionUsecase } from './application/judge-contradiction.usecase';
import { CONTRADICTION_JUDGE_PORT } from './domain/contradiction-judge.port';

// L4 모순 판정 — ModelRouterModule(ModelRouterUsecase export) 만 의존. model-router 는
// episodic-memory 를 import 하지 않으므로 순환 의존 없음.
@Module({
  imports: [ModelRouterModule],
  providers: [
    JudgeContradictionUsecase,
    {
      provide: CONTRADICTION_JUDGE_PORT,
      useExisting: JudgeContradictionUsecase,
    },
  ],
  exports: [CONTRADICTION_JUDGE_PORT],
})
export class ContradictionJudgeModule {}
