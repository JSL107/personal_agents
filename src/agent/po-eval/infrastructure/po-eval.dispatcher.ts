import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatEvaluationOutput } from '../../../slack/format/po-evaluation.formatter';
import { GeneratePoEvaluationUsecase } from '../application/generate-po-evaluation.usecase';

// PO 통합 facade 의 Router dispatcher.
// 진입 surface:
//   - 슬래시 `/po-eval [today|week]`
//   - Router 의 자연어 분류 (`PO_EVAL` agentType)
// range 명시 args 는 본 dispatcher 미지원 — usecase default (WEEK). 슬래시 핸들러에서 range 별 분기.
@Injectable()
export class PoEvalDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.PO_EVAL;

  constructor(
    private readonly generatePoEvaluation: GeneratePoEvaluationUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generatePoEvaluation.execute({
      slackUserId: input.slackUserId,
    });
    const formatted = formatEvaluationOutput(outcome.result);
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: `${formatted.summary}\n\n${formatted.detail}`,
    };
  }
}
