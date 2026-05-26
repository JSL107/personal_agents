import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatSreAnalysis } from '../../../slack/format/be-sre.formatter';
import { AnalyzeStackTraceUsecase } from '../application/analyze-stack-trace.usecase';

// BE_SRE worker 의 Router dispatcher — 자연어 메시지 (`input.text`) 가 stack trace 본문.
// 사용자가 trace 를 그대로 붙여 넣거나 webhook 이 텍스트로 받은 trace 가 input.text 로 들어옴.
@Injectable()
export class BeSreDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BE_SRE;

  constructor(private readonly analyzeStackTrace: AnalyzeStackTraceUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.analyzeStackTrace.execute({
      stackTrace: input.text ?? '',
      slackUserId: input.slackUserId,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatSreAnalysis(outcome.result),
    };
  }
}
