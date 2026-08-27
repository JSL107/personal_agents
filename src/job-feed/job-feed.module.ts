import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { CollectJobPostingsUsecase } from './application/collect-job-postings.usecase';
import { ListNotifiablePostingsUsecase } from './application/list-notifiable-postings.usecase';
import { ScoreJobPostingsUsecase } from './application/score-job-postings.usecase';
import { JOB_POSTING_REPOSITORY_PORT } from './domain/port/job-posting.repository.port';
import { JOB_SOURCES } from './domain/port/job-source.port';
import { JobPostingPrismaRepository } from './infrastructure/job-posting.prisma.repository';
import { JumpitSource } from './infrastructure/jumpit.source';
import { RallitSource } from './infrastructure/rallit.source';
import { WantedSource } from './infrastructure/wanted.source';

@Module({
  imports: [PrismaModule],
  providers: [
    JumpitSource,
    RallitSource,
    WantedSource,
    // 다중 provider 는 한 모듈에서 중앙 등록한다 — 분산 등록하면 주입 시점에 일부가 빠진다.
    {
      provide: JOB_SOURCES,
      useFactory: (
        jumpit: JumpitSource,
        rallit: RallitSource,
        wanted: WantedSource,
      ) => [jumpit, rallit, wanted],
      inject: [JumpitSource, RallitSource, WantedSource],
    },
    {
      provide: JOB_POSTING_REPOSITORY_PORT,
      useClass: JobPostingPrismaRepository,
    },
    CollectJobPostingsUsecase,
    ScoreJobPostingsUsecase,
    ListNotifiablePostingsUsecase,
  ],
  exports: [
    CollectJobPostingsUsecase,
    ScoreJobPostingsUsecase,
    ListNotifiablePostingsUsecase,
    JOB_POSTING_REPOSITORY_PORT,
  ],
})
export class JobFeedModule {}
