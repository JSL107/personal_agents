import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatSchemaProposal } from '../../../slack/format/be-schema.formatter';
import { GenerateSchemaProposalUsecase } from '../application/generate-schema-proposal.usecase';

// BE_SCHEMA worker 의 Router dispatcher — 자연어 메시지 (`input.text`) 를 request 로 매핑.
@Injectable()
export class BeSchemaDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BE_SCHEMA;

  constructor(
    private readonly generateSchemaProposal: GenerateSchemaProposalUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateSchemaProposal.execute({
      request: input.text ?? '',
      slackUserId: input.slackUserId,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatSchemaProposal(outcome.result),
    };
  }
}
