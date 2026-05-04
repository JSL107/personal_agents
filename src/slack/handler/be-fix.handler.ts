import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { AnalyzePrConventionUsecase } from '../../agent/be-fix/application/analyze-pr-convention.usecase';
import { formatPrConventionReport } from '../format/be-fix.formatter';
import { runAgentCommand } from './slack-handler.helper';

export interface BeFixHandlerDeps {
  analyzePrConventionUsecase: AnalyzePrConventionUsecase;
  logger: Logger;
}

// /be-fix <prRef> — GitHub PR diff 를 fetch → LLM 컨벤션 점검 → Slack 결과 노출.
// prRef 지원 형식: 123 / #123 / owner/repo#123 / https://github.com/owner/repo/pull/123
export const registerBeFixHandler = (
  app: App,
  deps: BeFixHandlerDeps,
): void => {
  app.command('/be-fix', async ({ ack, command, respond }) => {
    const prRef = command.text?.trim() ?? '';

    if (prRef.length === 0) {
      await ack({
        response_type: 'ephemeral',
        text: '사용법: `/be-fix <PR번호>` (예: `/be-fix owner/repo#123` 또는 `/be-fix https://github.com/owner/repo/pull/123`)',
      });
      return;
    }

    await ack({
      response_type: 'ephemeral',
      text: `이대리(BE-Fix 모드) 가 PR \`${prRef}\` 의 컨벤션을 점검 중입니다 (30~60초 소요)...`,
    });

    await runAgentCommand({
      respond,
      logger: deps.logger,
      commandLabel: '/be-fix',
      execute: () =>
        deps.analyzePrConventionUsecase.execute({
          prRef,
          slackUserId: command.user_id,
        }),
      format: formatPrConventionReport,
    });
  });
};
