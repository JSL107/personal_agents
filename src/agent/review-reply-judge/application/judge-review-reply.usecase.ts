import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  buildReviewReplyJudgePrompt,
  REVIEW_REPLY_JUDGE_SYSTEM_PROMPT,
} from '../domain/prompt/review-reply-judge.prompt';
import {
  JudgeReviewReplyInput,
  ReplyVerdict,
  ReviewReplyJudgment,
} from '../domain/review-reply-judge.type';
import { parseVerdictBatch } from '../domain/verdict-batch.parser';
import { extractCodexQuota } from './extract-codex-quota';

const VALID_VERDICTS: ReadonlySet<string> = new Set([
  'ACCEPTED',
  'REJECTED',
  'UNCLEAR',
]);

@Injectable()
export class JudgeReviewReplyUsecase {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    items,
  }: JudgeReviewReplyInput): Promise<ReviewReplyJudgment[]> {
    if (items.length === 0) {
      return [];
    }
    try {
      // 실행 원장에 남긴다 — 이 판정이 리뷰 채택/기각 학습 신호의 입력이라, 실패하거나
      // 느려지면 학습이 조용히 멈춘다. 그 사실이 드러나는 곳은 agent_run 뿐이다.
      const outcome = await this.agentRunService.execute<ReviewReplyJudgment[]>(
        {
          agentType: AgentType.REVIEW_REPLY_JUDGE,
          triggerType: TriggerType.PR_REVIEW_SWEEP,
          inputSnapshot: {
            itemCount: items.length,
            ids: items.map((item) => item.id),
          },
          run: async () => {
            const completion = await this.modelRouter.route({
              agentType: AgentType.REVIEW_REPLY_JUDGE,
              request: {
                prompt: buildReviewReplyJudgePrompt(items),
                systemPrompt: REVIEW_REPLY_JUDGE_SYSTEM_PROMPT,
              },
            });
            const judgments = parseVerdictBatch<ReplyVerdict>({
              text: completion.text,
              ids: items.map((item) => item.id),
              validVerdicts: VALID_VERDICTS,
              fallback: 'UNCLEAR',
            });
            return {
              result: judgments,
              modelUsed: completion.modelUsed,
              output: judgments,
            };
          },
        },
      );
      return outcome.result;
    } catch (error: unknown) {
      const quota = extractCodexQuota(error);
      if (quota) {
        throw quota;
      }
      throw error;
    }
  }
}
