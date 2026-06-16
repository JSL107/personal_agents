import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { AddApplicationUsecase } from './application/add-application.usecase';
import { ListApplicationsUsecase } from './application/list-applications.usecase';
import { UpdateApplicationUsecase } from './application/update-application.usecase';
import { JOB_APPLICATION_REPOSITORY_PORT } from './domain/port/job-application.repository.port';
import { JobApplicationDispatcher } from './infrastructure/job-application.dispatcher';
import { JobApplicationPrismaRepository } from './infrastructure/job-application.prisma.repository';

// PrismaModule 은 @Global() — 별도 import 불필요.
// ConfigModule 은 AppModule 에서 isGlobal: true — 별도 import 불필요.
//
// JOB_APPLICATION_REPOSITORY_PORT 토큰을 exports 에 노출 — 넛지 cron 모듈(배치 B)의
// consumer 가 동일 repository 구현을 주입받기 위함 (별도 재provide 회피).
@Module({
  imports: [AgentRunModule, ModelRouterModule],
  providers: [
    {
      provide: JOB_APPLICATION_REPOSITORY_PORT,
      useClass: JobApplicationPrismaRepository,
    },
    AddApplicationUsecase,
    UpdateApplicationUsecase,
    ListApplicationsUsecase,
    JobApplicationDispatcher,
  ],
  exports: [
    JOB_APPLICATION_REPOSITORY_PORT,
    AddApplicationUsecase,
    UpdateApplicationUsecase,
    ListApplicationsUsecase,
    JobApplicationDispatcher,
  ],
})
export class JobApplicationModule {}
