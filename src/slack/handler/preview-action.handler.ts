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
import { toReadableSlackArgs } from '../format/message-blocks.builder';
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
          ...toReadableSlackArgs(`✅ 적용 완료: ${resultText}`),
        });
      } catch (error: unknown) {
        // 카드를 덮어쓰지 않는다. 실패하면 usecase 가 카드를 버튼 있는 APPLY_FAILED 로 되살려 두는데,
        // 덮어쓰면 그 버튼이 사라져 다시 승인할 수 없다(2026-11-06 릴스 게시 실패).
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text: `적용 실패: ${toUserFacingErrorMessage(error)}`,
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
          text: '❌ 취소했어요. 다른 변경은 없어요.',
        });
      } catch (error: unknown) {
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `취소 실패: ${toUserFacingErrorMessage(error)}`,
        });
      }
    });
  }
}
