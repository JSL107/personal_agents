import { Injectable, Logger } from '@nestjs/common';
import { App, RespondFn } from '@slack/bolt';

import { formatRunIdLine } from '../../common/util/run-id-line.util';
import {
  PreparedReplay,
  ReplayFailedRunUsecase,
} from '../../run-replay/application/replay-failed-run.usecase';
import { ReplayRejectionCode } from '../../run-replay/domain/run-replay.type';
import { SlackHandler } from '../domain/port/slack-handler.port';
import { toReadableSlackArgs } from '../format/message-blocks.builder';
import { buildPreviewBlocks } from '../format/preview-message.builder';
import { ReplayReplyRunner } from '../format/replay-reply.runner';
import { toUserFacingErrorMessage } from './slack-handler.helper';

const KEEP_ORIGINAL_ON_REJECTION: ReadonlySet<ReplayRejectionCode> = new Set([
  ReplayRejectionCode.NOT_FOUND,
  ReplayRejectionCode.UNKNOWN_AGENT_TYPE,
]);

// /retry-run — FAILED AgentRun 의 inputSnapshot 으로 동일 작업을 재실행 (OPS-5).
// 판정·디스패치·재시도 계보는 콘솔 재시도 버튼과 함께 쓰는 `ReplayFailedRunUsecase` 에 있고,
// 실행과 결과 문구는 자연어 재실행과 함께 쓰는 `ReplayReplyRunner` 에 있다. 여기는 Slack ack 와 응답만 한다.
//
// C-4 Phase 9 — registerRetryRunHandler fn → @Injectable() class.
@Injectable()
export class RetryRunHandler implements SlackHandler {
  private readonly logger = new Logger(RetryRunHandler.name);

  constructor(
    private readonly replayFailedRunUsecase: ReplayFailedRunUsecase,
    private readonly replayReplyRunner: ReplayReplyRunner,
  ) {}

  register(app: App): void {
    app.command('/retry-run', async ({ ack, command, respond }) => {
      const idText = command.text?.trim() ?? '';
      const id = Number(idText);
      if (!idText || !Number.isInteger(id) || id <= 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/retry-run <id>` (예: `/retry-run 42`)',
        });
        return;
      }
      await ack({
        response_type: 'ephemeral',
        text: `이대리가 run #${id} 를 재실행하는 중입니다...`,
      });

      const prepared = await this.replayFailedRunUsecase.prepare({
        runId: id,
        requesterSlackUserId: command.user_id,
      });
      if (prepared.kind === 'REJECTED') {
        await respond({
          response_type: 'ephemeral',
          // 실행 기록 자체를 못 찾은 경우와 처음 보는 종류는 종전대로 진행 문구를 덮지 않는다.
          ...(KEEP_ORIGINAL_ON_REJECTION.has(prepared.code)
            ? {}
            : { replace_original: true }),
          text: prepared.message,
        });
        return;
      }
      await this.respondReplay({ prepared, respond });
    });
  }

  private async respondReplay({
    prepared,
    respond,
  }: {
    prepared: PreparedReplay;
    respond: RespondFn;
  }): Promise<void> {
    const commandLabel = retryCommandLabel(prepared);
    try {
      const reply = await this.replayReplyRunner.run(prepared);
      if (reply.preview) {
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: reply.preview.text,
          blocks: buildPreviewBlocks({
            previewText: reply.preview.text,
            previewId: reply.preview.id,
          }) as never,
        });
        if (reply.followupText !== undefined) {
          await respond({
            response_type: 'ephemeral',
            replace_original: false,
            ...toReadableSlackArgs(reply.followupText),
          });
        }
        return;
      }
      const text =
        prepared.agentType === 'PAPER_RECOMMEND' ||
        prepared.agentType === 'BLOG_PUBLISH'
          ? reply.text
          : `${reply.text}\n${formatRunIdLine(reply.agentRunId)}`;
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        ...toReadableSlackArgs(text),
      });
    } catch (error: unknown) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${commandLabel} 실패: ${rawMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `이대리 ${commandLabel} 실패: ${toUserFacingErrorMessage(error)}`,
      });
    }
  }
}

const retryCommandLabel = (prepared: PreparedReplay): string => {
  if (
    prepared.agentType === 'PO_SHADOW' ||
    prepared.agentType === 'PO_EVAL' ||
    prepared.agentType === 'CEO' ||
    prepared.agentType === 'PAPER_RECOMMEND' ||
    prepared.agentType === 'BLOG_PUBLISH'
  ) {
    return `/retry-run#${prepared.runId} (${prepared.agentType})`;
  }
  return `/retry-run(${prepared.agentType})`;
};
