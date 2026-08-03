import { Injectable } from '@nestjs/common';

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
  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async execute({
    items,
  }: JudgeReviewReplyInput): Promise<ReviewReplyJudgment[]> {
    if (items.length === 0) {
      return [];
    }
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.REVIEW_REPLY_JUDGE,
        request: {
          prompt: buildReviewReplyJudgePrompt(items),
          systemPrompt: REVIEW_REPLY_JUDGE_SYSTEM_PROMPT,
        },
      });
      return parseVerdictBatch<ReplyVerdict>({
        text: completion.text,
        ids: items.map((item) => item.id),
        validVerdicts: VALID_VERDICTS,
        fallback: 'UNCLEAR',
      });
    } catch (error: unknown) {
      const quota = extractCodexQuota(error);
      if (quota) {
        throw quota;
      }
      throw error;
    }
  }
}
