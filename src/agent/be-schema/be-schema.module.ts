import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { CodeGraphModule } from '../../code-graph/code-graph.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { GenerateSchemaProposalUsecase } from './application/generate-schema-proposal.usecase';
import { SCHEMA_FILE_READER_PORT } from './domain/port/schema-file.reader.port';
import { PrismaSchemaFileReader } from './infrastructure/prisma-schema-file.reader';

@Module({
  // V3 단계 5 — CodeGraphModule import 로 BuildCodeGraphUsecase + CodeGraphQueryUsecase 사용.
  imports: [AgentRunModule, ModelRouterModule, CodeGraphModule],
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
