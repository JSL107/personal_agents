import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GithubModule } from '../../github/github.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { NotionModule } from '../../notion/notion.module';
import { AnalyzeJdGapUsecase } from './application/analyze-jd-gap.usecase';
import { BuildCareerProfileUsecase } from './application/build-career-profile.usecase';
import { CalibrateResumeUsecase } from './application/calibrate-resume.usecase';
import { RenderPortfolioUsecase } from './application/render-portfolio.usecase';
import { RenderResumeUsecase } from './application/render-resume.usecase';
import { CAREER_PROFILE_REPOSITORY_PORT } from './domain/port/career-profile.repository.port';
import { CareerMateDispatcher } from './infrastructure/career-mate.dispatcher';
import { CareerProfilePrismaRepository } from './infrastructure/career-profile.prisma.repository';

// PrismaModule(@Global) / ConfigModule(isGlobal) 은 별도 import 불필요.
@Module({
  imports: [AgentRunModule, ModelRouterModule, GithubModule, NotionModule],
  providers: [
    {
      provide: CAREER_PROFILE_REPOSITORY_PORT,
      useClass: CareerProfilePrismaRepository,
    },
    BuildCareerProfileUsecase,
    RenderResumeUsecase,
    RenderPortfolioUsecase,
    AnalyzeJdGapUsecase,
    CalibrateResumeUsecase,
    CareerMateDispatcher,
  ],
  exports: [
    BuildCareerProfileUsecase,
    RenderResumeUsecase,
    RenderPortfolioUsecase,
    AnalyzeJdGapUsecase,
    CalibrateResumeUsecase,
    CareerMateDispatcher,
  ],
})
export class CareerMateModule {}
