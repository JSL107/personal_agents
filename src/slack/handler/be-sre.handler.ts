import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { AnalyzeStackTraceUsecase } from '../../agent/be-sre/application/analyze-stack-trace.usecase';
import { formatSreAnalysis } from '../format/be-sre.formatter';
import { runAgentCommand } from './slack-handler.helper';

export interface BeSreHandlerDeps {
  analyzeStackTraceUsecase: AnalyzeStackTraceUsecase;
  logger: Logger;
}

// 단일 Slack 메시지 안에 붙여넣을 수 있는 stack trace 의 합리적 상한.
// 이 이상이면 악의적 DoS 또는 실수로 매우 큰 blob 을 전달한 경우로 간주한다.
const STACK_TRACE_CHAR_LIMIT = 50_000;

// /be-sre <stack trace> — TS stack trace 분석 → root cause + patch 제안 → Slack 응답.
export const registerBeSreHandler = (
  app: App,
  deps: BeSreHandlerDeps,
): void => {
  app.command('/be-sre', async ({ ack, command, respond }) => {
    const text = command.text?.trim() ?? '';

    if (text.length === 0) {
      await ack({
        response_type: 'ephemeral',
        text: '사용법: `/be-sre <stack trace 전체 paste>` (예: Node.js 오류 메시지와 at ... 줄을 모두 붙여넣으세요)',
      });
      return;
    }

    if (text.length > STACK_TRACE_CHAR_LIMIT) {
      await ack({
        response_type: 'ephemeral',
        text: `stack trace 가 너무 깁니다 (${text.length.toLocaleString()}자). ${STACK_TRACE_CHAR_LIMIT.toLocaleString()}자 이하로 줄여서 다시 시도해주세요.`,
      });
      return;
    }

    await ack({
      response_type: 'ephemeral',
      text: '이대리(BE-SRE 모드) 가 stack trace 를 분석 중입니다 (30~60초 소요)...',
    });

    await runAgentCommand({
      respond,
      logger: deps.logger,
      commandLabel: '/be-sre',
      execute: () =>
        deps.analyzeStackTraceUsecase.execute({
          stackTrace: text,
          slackUserId: command.user_id,
        }),
      format: formatSreAnalysis,
    });
  });
};
