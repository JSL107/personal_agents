import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatVideoWatch } from '../../../slack/format/video-watch.formatter';
import { WatchVideoUsecase } from '../application/watch-video.usecase';

// "이 영상 설명해줘" 에 링크 요청으로 답한 뒤 다음 턴에 링크만 오면, 원래 질문은 분류기가
// userInstruction 으로만 넘긴다. 합치지 않으면 기본 요약 질문으로 바뀐다 (BLOG dispatcher 와 같은 방식).
const buildVideoRequestText = (input: DispatchInput): string => {
  const text = input.text ?? '';
  const userInstruction = input.conversationContext?.userInstruction?.trim();
  if (!userInstruction) {
    return text;
  }
  return `${text}\n\n[대화 맥락] ${userInstruction}`;
};

@Injectable()
export class VideoWatchDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.VIDEO_WATCH;

  constructor(private readonly watchVideo: WatchVideoUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.watchVideo.execute({
      slackUserId: input.slackUserId,
      text: buildVideoRequestText(input),
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatVideoWatch(outcome.result, outcome.report),
    };
  }
}
