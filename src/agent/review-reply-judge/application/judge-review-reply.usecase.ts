import { Injectable } from '@nestjs/common';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CodexQuotaExceededException } from '../../../model-router/infrastructure/codex-cli.provider';
import {
  buildReviewReplyJudgePrompt,
  REVIEW_REPLY_JUDGE_SYSTEM_PROMPT,
} from '../domain/prompt/review-reply-judge.prompt';
import {
  JudgeReviewReplyInput,
  ReplyVerdict,
  ReviewReplyJudgment,
} from '../domain/review-reply-judge.type';

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
      return this.parse({ text: completion.text, input: { items } });
    } catch (error: unknown) {
      const quota = this.extractQuota(error);
      if (quota) {
        throw quota;
      }
      throw error;
    }
  }

  private parse({
    text,
    input,
  }: {
    text: string;
    input: JudgeReviewReplyInput;
  }): ReviewReplyJudgment[] {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      return this.toUnclear(input);
    }

    try {
      const parsed = JSON.parse(match[0]) as unknown;
      if (!Array.isArray(parsed)) {
        return this.toUnclear(input);
      }
      const byId = new Map<number, ReviewReplyJudgment>();
      for (const value of parsed) {
        if (typeof value !== 'object' || value === null) {
          continue;
        }
        const record = value as Record<string, unknown>;
        if (
          typeof record.id !== 'number' ||
          typeof record.verdict !== 'string' ||
          !VALID_VERDICTS.has(record.verdict)
        ) {
          continue;
        }
        byId.set(record.id, {
          id: record.id,
          verdict: record.verdict as ReplyVerdict,
          reason: typeof record.reason === 'string' ? record.reason : '',
        });
      }
      return input.items.map(
        (item) =>
          byId.get(item.id) ?? {
            id: item.id,
            verdict: 'UNCLEAR',
            reason: '',
          },
      );
    } catch {
      return this.toUnclear(input);
    }
  }

  private toUnclear(input: JudgeReviewReplyInput): ReviewReplyJudgment[] {
    return input.items.map((item) => ({
      id: item.id,
      verdict: 'UNCLEAR',
      reason: '',
    }));
  }

  private extractQuota(error: unknown): CodexQuotaExceededException | null {
    const seen = new Set<unknown>();
    const stack: unknown[] = [error];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current == null || seen.has(current)) {
        continue;
      }
      seen.add(current);
      if (current instanceof CodexQuotaExceededException) {
        return current;
      }
      if (typeof current === 'object') {
        const record = current as Record<string, unknown>;
        stack.push(record.cause, record.primaryError, record.lastError);
      }
    }
    return null;
  }
}
