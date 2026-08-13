import { Module } from '@nestjs/common';

import { GithubModule } from '../github/github.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PublishFindingsService } from './application/publish-findings.service';
import { PR_REVIEW_FINDING_REPOSITORY_PORT } from './domain/port/pr-review-finding.repository.port';
import { PrReviewFindingPrismaRepository } from './infrastructure/pr-review-finding.prisma.repository';

@Module({
  imports: [PrismaModule, GithubModule],
  providers: [
    PublishFindingsService,
    {
      provide: PR_REVIEW_FINDING_REPOSITORY_PORT,
      useClass: PrReviewFindingPrismaRepository,
    },
  ],
  exports: [PublishFindingsService, PR_REVIEW_FINDING_REPOSITORY_PORT],
})
export class PrReviewPublishModule {}
