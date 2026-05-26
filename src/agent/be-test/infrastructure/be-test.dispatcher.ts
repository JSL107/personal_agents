import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { GenerateTestUsecase } from '../application/generate-test.usecase';

// BE_TEST worker 의 Router dispatcher — 자연어 메시지 (`input.text`) 를 filePath 로 매핑.
// classifier 가 사용자 발화에서 대상 파일 경로를 식별해 input.text 로 넘기는 가정.
// 잘못된 경로는 GenerateTestUsecase 가 INVALID_PATH/FILE_NOT_FOUND 로 reject.
@Injectable()
export class BeTestDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BE_TEST;

  constructor(private readonly generateTest: GenerateTestUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateTest.execute({
      filePath: input.text ?? '',
      slackUserId: input.slackUserId,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
    };
  }
}
