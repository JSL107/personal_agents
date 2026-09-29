import { Module } from '@nestjs/common';

import { AgentRunModule } from '../agent-run/agent-run.module';
import { CodeGraphModule } from '../code-graph/code-graph.module';
import { ModelRouterModule } from '../model-router/model-router.module';
import { JudgeStudyApplicabilityUsecase } from './application/judge-study-applicability.usecase';
import { STUDY_BRIEF_REPOSITORY_PORT } from './domain/port/study-brief.repository.port';
import { StudyBriefPrismaRepository } from './infrastructure/study-brief.prisma.repository';

@Module({
  imports: [AgentRunModule, ModelRouterModule, CodeGraphModule],
  providers: [
    JudgeStudyApplicabilityUsecase,
    {
      provide: STUDY_BRIEF_REPOSITORY_PORT,
      useClass: StudyBriefPrismaRepository,
    },
  ],
  exports: [JudgeStudyApplicabilityUsecase, STUDY_BRIEF_REPOSITORY_PORT],
})
export class StudyApplicabilityModule {}
