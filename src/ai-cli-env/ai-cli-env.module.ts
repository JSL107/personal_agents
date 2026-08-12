import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AI_CLI_ENV_PORT } from './domain/port/ai-cli-env.port';
import { AiCliEnvAdapter } from './infrastructure/ai-cli-env.adapter';

@Module({
  imports: [ConfigModule],
  providers: [
    AiCliEnvAdapter,
    {
      provide: AI_CLI_ENV_PORT,
      useExisting: AiCliEnvAdapter,
    },
  ],
  exports: [AI_CLI_ENV_PORT],
})
export class AiCliEnvModule {}
