import { Injectable, Logger } from '@nestjs/common';
import { App, RespondFn } from '@slack/bolt';

import { PublishNotionDraftUsecase } from '../../agent/blog/application/publish-notion-draft.usecase';
import { PublishNotionDraftResult } from '../../agent/blog/domain/blog.type';
import { AgentRunOutcome } from '../../agent-run/application/agent-run.service';
import { SlackHandler } from '../domain/port/slack-handler.port';
import { formatModelFooter } from '../format/model-footer.formatter';
import { buildPreviewBlocks } from '../format/preview-message.builder';
import { toUserFacingErrorMessage } from './slack-handler.helper';

@Injectable()
export class BlogPublishHandler implements SlackHandler {
  private readonly logger = new Logger(BlogPublishHandler.name);

  constructor(private readonly publishNotionDraft: PublishNotionDraftUsecase) {}

  register(app: App): void {
    app.command('/blog-publish', async ({ ack, command, respond }) => {
      await ack({
        response_type: 'ephemeral',
        text: 'Notion 블로그 초안을 익명화하고 발행 미리보기를 만드는 중입니다...',
      });
      try {
        const outcome = await this.publishNotionDraft.execute({
          slackUserId: command.user_id,
          titleQuery: command.text?.trim() ?? '',
          responseUrl: command.response_url,
        });
        await respondBlogPublishOutcome(respond, outcome);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `/blog-publish 실패: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /blog-publish 실패: ${toUserFacingErrorMessage(error)}`,
        });
      }
    });
  }
}

export const respondBlogPublishOutcome = async (
  respond: RespondFn,
  outcome: AgentRunOutcome<PublishNotionDraftResult>,
): Promise<void> => {
  const result = outcome.result;
  if (result.status !== 'preview') {
    await respond({
      response_type: 'ephemeral',
      replace_original: true,
      text: result.message + formatModelFooter(outcome),
    });
    return;
  }
  await respond({
    response_type: 'ephemeral',
    replace_original: true,
    text: result.previewText,
    blocks: buildPreviewBlocks({
      previewText: result.previewText,
      previewId: result.previewId,
    }) as never,
  });
  await respond({
    response_type: 'ephemeral',
    replace_original: false,
    text: result.content + formatModelFooter(outcome),
  });
};
