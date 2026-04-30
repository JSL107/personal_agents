import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { GenerateTestUsecase } from '../../agent/be-test/application/generate-test.usecase';
import { formatGeneratedTest } from '../format/be-test.formatter';
import { runAgentCommand } from './slack-handler.helper';

export interface BeTestHandlerDeps {
  generateTestUsecase: GenerateTestUsecase;
  logger: Logger;
}

// /be-test <파일경로> — Tree-sitter AST 분석 → spec 생성 → sandbox 검증 (max 3회 self-correction).
export const registerBeTestHandler = (
  app: App,
  deps: BeTestHandlerDeps,
): void => {
  app.command('/be-test', async ({ ack, command, respond }) => {
    const filePath = command.text?.trim() ?? '';

    if (filePath.length === 0) {
      await ack({
        response_type: 'ephemeral',
        text: '사용법: `/be-test <파일경로>` (예: `/be-test src/agent/be-schema/application/generate-schema-proposal.usecase.ts`)',
      });
      return;
    }

    await ack({
      response_type: 'ephemeral',
      text: `이대리(BE-Test 모드) 가 ${filePath} 의 spec 을 생성 중입니다 (30~60초 소요)...`,
    });

    await runAgentCommand({
      respond,
      logger: deps.logger,
      commandLabel: '/be-test',
      execute: () =>
        deps.generateTestUsecase.execute({
          filePath,
          slackUserId: command.user_id,
        }),
      format: formatGeneratedTest,
    });
  });
};
