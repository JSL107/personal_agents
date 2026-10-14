import { Injectable } from '@nestjs/common';

import { TriageIdeaChannelUsecase } from '../../../idea-triage/application/triage-idea-channel.usecase';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class IdeaTriageAutopilotTask implements AutopilotTask {
  readonly id = 'idea-triage';

  constructor(private readonly triageIdeaChannel: TriageIdeaChannelUsecase) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const result = await this.triageIdeaChannel.execute({
      ownerSlackUserId: context.ownerSlackUserId,
      firedAtKst: context.firedAtKst,
    });
    if ('skipped' in result) {
      return { skip: true };
    }
    if (result.judged === 0 && result.posted === 0 && result.failed === 0) {
      return { skip: true, emptyReason: '새 아이디어 없음' };
    }
    return {
      skip: false,
      summaryText: `💡 아이디어 ${result.judged}건 판정 — 만든다 ${result.byVerdict.BUILD} · 고치고 만든다 ${result.byVerdict.REVISE_THEN_BUILD} · 접는다 ${result.byVerdict.DROP} (실패 ${result.failed})`,
    };
  }
}
