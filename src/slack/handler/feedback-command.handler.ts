import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { SaveReviewOutcomeUsecase } from '../../agent/code-reviewer/application/save-review-outcome.usecase';

// QA-1 Reviewer Learning — /review-feedback <AgentRun ID> accept|reject [이유].
// LLM 호출 안 함 (DB 만) — runAgentCommand 의 outcome footer 패턴 미해당.
// agent-command.handler 분할 (V3 audit P2) — 본 file 로 분리.
export interface FeedbackCommandHandlerDeps {
  saveReviewOutcomeUsecase: SaveReviewOutcomeUsecase;
  logger: Logger;
}

export const registerFeedbackCommandHandlers = (
  app: App,
  deps: FeedbackCommandHandlerDeps,
): void => {
  app.command('/review-feedback', async ({ ack, command, respond }) => {
    const parts = (command.text ?? '').trim().split(/\s+/);
    const runId = Number(parts[0]);
    const verdict = (parts[1] ?? '').toLowerCase();

    if (
      !parts[0] ||
      !Number.isInteger(runId) ||
      runId <= 0 ||
      !['accept', 'reject'].includes(verdict)
    ) {
      await ack({
        response_type: 'ephemeral',
        text: '사용법: `/review-feedback <AgentRun ID> accept|reject [이유]`\n예: `/review-feedback 42 reject 너무 사소한 스타일 지적`',
      });
      return;
    }
    await ack({ response_type: 'ephemeral', text: '피드백 저장 중...' });

    const accepted = verdict === 'accept';
    const comment = parts.slice(2).join(' ') || undefined;
    try {
      await deps.saveReviewOutcomeUsecase.execute({
        agentRunId: runId,
        slackUserId: command.user_id,
        accepted,
        comment,
      });
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `AgentRun #${runId} 피드백 저장 완료 (${accepted ? '✅ accept' : '❌ reject'}${comment ? ` — ${comment}` : ''})`,
      });
    } catch (error: unknown) {
      deps.logger.error(
        `/review-feedback 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `피드백 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
};
