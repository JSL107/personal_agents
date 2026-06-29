import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatCeoMetaOutput } from '../../../slack/format/ceo-meta.formatter';
import { GenerateCeoMetaUsecase } from '../application/generate-ceo-meta.usecase';

// CEO worker 의 Router dispatcher.
// 진입 surface:
//   - 슬래시 `/ceo-review [today|week]`
//   - Router 의 자연어 분류 (`CEO` agentType)
// range 명시 args 는 본 dispatcher 미지원 — usecase default (WEEK). 슬래시 핸들러에서 range 별 분기.
@Injectable()
export class CeoDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.CEO;

  constructor(private readonly generateCeoMeta: GenerateCeoMetaUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateCeoMeta.execute({
      slackUserId: input.slackUserId,
    });
    const formatted = formatCeoMetaOutput(outcome.result);
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: `${formatted.summary}\n\n${formatted.detail}`,
    };
  }
}
