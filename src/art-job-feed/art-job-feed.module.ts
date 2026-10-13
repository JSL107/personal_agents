import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import {
  ART_JOB_SOURCE_PORT,
  GAME_IMAGE_RESOLVER_PORT,
  IMAGE_DOWNLOADER_PORT,
} from './domain/port/art-job-feed.ports';
import { ART_JOB_POSTING_REPOSITORY_PORT } from './domain/port/art-job-posting.repository.port';
import { ArtJobPostingPrismaRepository } from './infrastructure/art-job-posting.prisma.repository';
import { GameImageResolver } from './infrastructure/game-image.resolver';
import { GamejobSource } from './infrastructure/gamejob.source';
import { ImageDownloader } from './infrastructure/image.downloader';

@Module({
  imports: [PrismaModule],
  providers: [
    { provide: ART_JOB_SOURCE_PORT, useClass: GamejobSource },
    { provide: GAME_IMAGE_RESOLVER_PORT, useClass: GameImageResolver },
    { provide: IMAGE_DOWNLOADER_PORT, useClass: ImageDownloader },
    {
      provide: ART_JOB_POSTING_REPOSITORY_PORT,
      useClass: ArtJobPostingPrismaRepository,
    },
  ],
  exports: [
    ART_JOB_SOURCE_PORT,
    GAME_IMAGE_RESOLVER_PORT,
    IMAGE_DOWNLOADER_PORT,
    ART_JOB_POSTING_REPOSITORY_PORT,
  ],
})
export class ArtJobFeedModule {}
