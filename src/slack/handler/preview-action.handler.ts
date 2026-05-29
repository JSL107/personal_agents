import { Injectable } from '@nestjs/common';
import { App } from '@slack/bolt';

import { ApplyPreviewUsecase } from '../../preview-gate/application/apply-preview.usecase';
import { CancelPreviewUsecase } from '../../preview-gate/application/cancel-preview.usecase';
import { PREVIEW_ACTION_IDS } from '../../preview-gate/domain/preview-action.type';
import {
  extractActionUserId,
  extractActionValue,
} from '../bolt/action-body.parser';
import { SlackHandler } from '../domain/port/slack-handler.port';
import { toUserFacingErrorMessage } from './slack-handler.helper';

// PO-2 Preview Gate — apply / cancel 버튼 클릭 처리.
// body.actions[0].value 에 previewId, body.user.id 가 클릭한 사용자.
// usecase 가 owner 매칭 + ttl + status 검증 + strategy.apply 위임.
//
// C-4 Phase 1 — SlackHandler 시범 마이그레이션. SLACK_HANDLER_PORT multi-provider 로
// SlackModule 에 등록 → SlackService 가 부팅 시 register(app) 자동 호출.
@Injectable()
export class PreviewActionHandler implements SlackHandler {
  constructor(
    private readonly applyPreviewUsecase: ApplyPreviewUsecase,
    private readonly cancelPreviewUsecase: CancelPreviewUsecase,
  ) {}

  register(app: App): void {
    app.action(PREVIEW_ACTION_IDS.APPLY, async ({ ack, body, respond }) => {
      await ack();
      const previewId = extractActionValue(body);
      const slackUserId = extractActionUserId(body);
      if (!previewId || !slackUserId) {
        return;
      }
      try {
        const { resultText } = await this.applyPreviewUsecase.execute({
          previewId,
          slackUserId,
        });
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `✅ Preview 적용 완료 — ${resultText}`,
        });
      } catch (error: unknown) {
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `Preview 적용 실패: ${toUserFacingErrorMessage(error)}`,
        });
      }
    });

    app.action(PREVIEW_ACTION_IDS.CANCEL, async ({ ack, body, respond }) => {
      await ack();
      const previewId = extractActionValue(body);
      const slackUserId = extractActionUserId(body);
      if (!previewId || !slackUserId) {
        return;
      }
      try {
        await this.cancelPreviewUsecase.execute({ previewId, slackUserId });
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: '❌ Preview 취소됨 — 부작용 없이 마감되었습니다.',
        });
      } catch (error: unknown) {
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `Preview 취소 실패: ${toUserFacingErrorMessage(error)}`,
        });
      }
    });
  }
}
