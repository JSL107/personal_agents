import { Module } from '@nestjs/common';

import { GOAL_QUESTION_REPOSITORY_PORT } from './domain/port/goal-question.repository.port';
import { PRODUCT_GOAL_REPOSITORY_PORT } from './domain/port/product-goal.repository.port';
import { GoalQuestionPrismaRepository } from './infrastructure/goal-question.prisma.repository';
import { ProductGoalPrismaRepository } from './infrastructure/product-goal.prisma.repository';

// 저장소만 담는다. PreviewGateModule.forRoot 가 applier 를 위해 이 모듈을 import 하는데,
// PoShadowModule 을 통째로 넣으면 그 모듈이 쓰는 PreviewGate 전역 provider 와 순환한다.
@Module({
  providers: [
    {
      provide: GOAL_QUESTION_REPOSITORY_PORT,
      useClass: GoalQuestionPrismaRepository,
    },
    {
      provide: PRODUCT_GOAL_REPOSITORY_PORT,
      useClass: ProductGoalPrismaRepository,
    },
  ],
  exports: [GOAL_QUESTION_REPOSITORY_PORT, PRODUCT_GOAL_REPOSITORY_PORT],
})
export class ProductGoalModule {}
