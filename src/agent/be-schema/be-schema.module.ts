import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { CodeGraphModule } from '../../code-graph/code-graph.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { AGENT_DISPATCHER_PORT } from '../../router/domain/port/agent-dispatcher.port';
import { GenerateSchemaProposalUsecase } from './application/generate-schema-proposal.usecase';
import { SCHEMA_FILE_READER_PORT } from './domain/port/schema-file.reader.port';
import { BeSchemaDispatcher } from './infrastructure/be-schema.dispatcher';
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
    BeSchemaDispatcher,
    {
      provide: AGENT_DISPATCHER_PORT,
      useExisting: BeSchemaDispatcher,
      multi: true,
    },
  ],
  exports: [GenerateSchemaProposalUsecase, AGENT_DISPATCHER_PORT],
})
export class BeSchemaModule {}
