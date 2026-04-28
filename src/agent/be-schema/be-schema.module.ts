import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { GenerateSchemaProposalUsecase } from './application/generate-schema-proposal.usecase';
import { SCHEMA_FILE_READER_PORT } from './domain/port/schema-file.reader.port';
import { PrismaSchemaFileReader } from './infrastructure/prisma-schema-file.reader';

@Module({
  imports: [AgentRunModule, ModelRouterModule],
  providers: [
    GenerateSchemaProposalUsecase,
    {
      provide: SCHEMA_FILE_READER_PORT,
      useClass: PrismaSchemaFileReader,
    },
  ],
  exports: [GenerateSchemaProposalUsecase],
})
export class BeSchemaModule {}
