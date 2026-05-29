import { Injectable, Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { SyncPlanUsecase } from '../../agent/pm/application/sync-plan.usecase';
import { SlackHandler } from '../domain/port/slack-handler.port';
import { buildPreviewBlocks } from '../format/preview-message.builder';
import { toUserFacingErrorMessage } from './slack-handler.helper';

// PM-2 Write-back — /sync-plan 은 후보 추출 + PreviewAction 생성 후 Block Kit 미리보기 메시지 발송.
// 사용자가 ✅ 누르면 preview-action.handler 에서 PmWriteBackApplier 로 위임.
// runAgentCommand 패턴이 안 맞는 이유: 응답이 단일 텍스트가 아니라 `text + blocks` 이고
// AgentRunOutcome 푸터도 없어 별도 try/catch 로 처리.
//
// C-4 Phase 4 — registerWriteBackHandlers fn → @Injectable() class.
@Injectable()
export class WriteBackHandler implements SlackHandler {
  private readonly logger = new Logger(WriteBackHandler.name);

  constructor(private readonly syncPlanUsecase: SyncPlanUsecase) {}

  register(app: App): void {
    app.command('/sync-plan', async ({ ack, command, respond }) => {
      await ack({
        response_type: 'ephemeral',
        text: '이대리가 동기화할 task 후보를 모으는 중입니다 (5~10초 소요)...',
      });

      try {
        const { previewId, previewText } = await this.syncPlanUsecase.execute({
          slackUserId: command.user_id,
        });
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: previewText,
          // Block Kit 의 apply/cancel 버튼 — 클릭 시 preview-action.handler 로 라우팅.
          blocks: buildPreviewBlocks({ previewText, previewId }) as never,
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `SyncPlanUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /sync-plan 실패: ${toUserFacingErrorMessage(error)}`,
        });
      }
    });
  }
}
