import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GithubModule } from '../../github/github.module';
import { HumanizeModule } from '../../humanize/humanize.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { NotionModule } from '../../notion/notion.module';
import { AnalyzeJdGapUsecase } from './application/analyze-jd-gap.usecase';
import { AuditResumeUsecase } from './application/audit-resume.usecase';
import { BuildCareerProfileUsecase } from './application/build-career-profile.usecase';
import { CalibrateResumeUsecase } from './application/calibrate-resume.usecase';
import { PublishPortfolioSiteUsecase } from './application/publish-portfolio-site.usecase';
import { ReflectPrUsecase } from './application/reflect-pr.usecase';
import { RenderPortfolioUsecase } from './application/render-portfolio.usecase';
import { RenderResumeUsecase } from './application/render-resume.usecase';
import { CAREER_PROFILE_REPOSITORY_PORT } from './domain/port/career-profile.repository.port';
import { CAREER_TARGET_JD_REPOSITORY_PORT } from './domain/port/career-target-jd.repository.port';
import { PORTFOLIO_SITE_CLIENT_PORT } from './domain/port/portfolio-site.client.port';
import { CareerMateDispatcher } from './infrastructure/career-mate.dispatcher';
import { CareerProfilePrismaRepository } from './infrastructure/career-profile.prisma.repository';
import { CareerTargetJdPrismaRepository } from './infrastructure/career-target-jd.prisma.repository';
import { PortfolioSiteApiClient } from './infrastructure/portfolio-site-api.client';

// PrismaModule(@Global) / ConfigModule(isGlobal) 은 별도 import 불필요.
@Module({
  imports: [
    AgentRunModule,
    ModelRouterModule,
    GithubModule,
    NotionModule,
    HumanizeModule,
  ],
  providers: [
    {
      provide: CAREER_PROFILE_REPOSITORY_PORT,
      useClass: CareerProfilePrismaRepository,
    },
    {
      provide: PORTFOLIO_SITE_CLIENT_PORT,
      useClass: PortfolioSiteApiClient,
    },
    {
      provide: CAREER_TARGET_JD_REPOSITORY_PORT,
      useClass: CareerTargetJdPrismaRepository,
    },
    BuildCareerProfileUsecase,
    RenderResumeUsecase,
    RenderPortfolioUsecase,
    AnalyzeJdGapUsecase,
    AuditResumeUsecase,
    CalibrateResumeUsecase,
    ReflectPrUsecase,
    PublishPortfolioSiteUsecase,
    CareerMateDispatcher,
  ],
  exports: [
    BuildCareerProfileUsecase,
    RenderResumeUsecase,
    RenderPortfolioUsecase,
    AnalyzeJdGapUsecase,
    AuditResumeUsecase,
    CalibrateResumeUsecase,
    ReflectPrUsecase,
    PublishPortfolioSiteUsecase,
    CareerMateDispatcher,
  ],
})
export class CareerMateModule {}
