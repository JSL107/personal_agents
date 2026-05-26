import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatPoShadowReport } from '../../../slack/format/po-shadow.formatter';
import { GeneratePoShadowUsecase } from '../application/generate-po-shadow.usecase';

// PO_SHADOW worker 의 Router dispatcher — 자연어 메시지가 있으면 extraContext 로 전달.
// 빈 텍스트면 extraContext 미지정 (usecase 가 직전 PM run 기반으로 동작).
@Injectable()
export class PoShadowDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.PO_SHADOW;

  constructor(private readonly generatePoShadow: GeneratePoShadowUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const trimmed = input.text?.trim() ?? '';
    const outcome = await this.generatePoShadow.execute({
      slackUserId: input.slackUserId,
      extraContext: trimmed.length > 0 ? trimmed : undefined,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatPoShadowReport(outcome.result),
    };
  }
}
