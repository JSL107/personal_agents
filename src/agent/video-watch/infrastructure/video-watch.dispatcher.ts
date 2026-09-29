import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatVideoWatch } from '../../../slack/format/video-watch.formatter';
import { WatchVideoUsecase } from '../application/watch-video.usecase';

@Injectable()
export class VideoWatchDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.VIDEO_WATCH;

  constructor(private readonly watchVideo: WatchVideoUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.watchVideo.execute({
      slackUserId: input.slackUserId,
      text: input.text ?? '',
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatVideoWatch(outcome.result, outcome.report),
    };
  }
}
