import { Module } from '@nestjs/common';

import { INSTAGRAM_POST_REPOSITORY_PORT } from './domain/port/instagram-post.repository.port';
import { META_GRAPH_PORT } from './domain/port/meta-graph.port';
import { InstagramPostPrismaRepository } from './infrastructure/instagram-post.prisma.repository';
import { MetaGraphClient } from './infrastructure/meta-graph.client';

@Module({
  providers: [
    {
      provide: INSTAGRAM_POST_REPOSITORY_PORT,
      useClass: InstagramPostPrismaRepository,
    },
    { provide: META_GRAPH_PORT, useClass: MetaGraphClient },
  ],
  exports: [INSTAGRAM_POST_REPOSITORY_PORT, META_GRAPH_PORT],
})
export class InstagramModule {}
