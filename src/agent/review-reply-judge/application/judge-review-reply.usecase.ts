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
            const parsed = parseVerdictBatch<ReplyVerdict>({
              text: completion.text,
              ids: items.map((item) => item.id),
              validVerdicts: VALID_VERDICTS,
              fallback: 'UNCLEAR',
            });
            if (!parsed.extracted) {
              // 전건 UNCLEAR 로 조용히 넘기지 않는다. 형식 위반은 모델 호출 실패이고,
              // 미결로 통과시키면 원장에는 성공으로 남는다. 게다가 수확 쪽은 미결도
              // checkpoint 에 기록하므로(같은 답글 재판정 방지) 답글이 바뀌기 전까지
              // 그 카드가 영구히 미결로 굳는다. 실패로 올려 재시도 경로에 태운다.
              throw new Error(
                `답글 판정 응답에서 JSON 배열을 뽑지 못했다 (항목 ${items.length}건)`,
              );
            }
            return {
              result: parsed.rows,
              modelUsed: completion.modelUsed,
              output: parsed.rows,
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
