import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EpisodicMemoryService } from './application/episodic-memory.service';
import { EMBEDDER_PORT } from './domain/port/embedder.port';
import { EPISODIC_MEMORY_PORT } from './domain/port/episodic-memory.port';
import { EpisodicMemoryRepository } from './infrastructure/episodic-memory.repository';
import { LocalEmbedder } from './infrastructure/local-embedder.adapter';

// PrismaService / ConfigService 는 각각 @Global() PrismaModule / isGlobal ConfigModule 로
// 전역 제공되므로 별도 imports 불필요.
const DEFAULT_EMBED_MODEL = 'Xenova/multilingual-e5-small';

@Module({
  providers: [
    EpisodicMemoryRepository,
    EpisodicMemoryService,
    {
      provide: EMBEDDER_PORT,
      useFactory: (configService: ConfigService) => {
        const modelId =
          configService.get<string>('EPISODIC_EMBED_MODEL') ??
          DEFAULT_EMBED_MODEL;
        return new LocalEmbedder(modelId);
      },
      inject: [ConfigService],
    },
    {
      provide: EPISODIC_MEMORY_PORT,
      useExisting: EpisodicMemoryService,
    },
  ],
  exports: [EPISODIC_MEMORY_PORT],
})
export class EpisodicMemoryModule {}
