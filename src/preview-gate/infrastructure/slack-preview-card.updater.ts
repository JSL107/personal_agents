import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebClient } from '@slack/web-api';

import { buildResolvedPreviewBlocks } from '../../slack/format/preview-message.builder';
import {
  PreviewCardPort,
  PreviewCardState,
} from '../domain/port/preview-card.port';
import { PreviewAction } from '../domain/preview-action.type';

// preview-gate.module useFactory 가 채우는 WebClient(토큰 미설정 시 null) 주입 토큰.
export const PREVIEW_CARD_SLACK_CLIENT = Symbol('PREVIEW_CARD_SLACK_CLIENT');

// A 경로 카드를 chat.update 로 다시 그린다. SlackService 를 직접 물면 SlackModule ↔
// (global) PreviewGateModule 순환이 나므로, blog SlackWebNotifier 선례처럼 자체 WebClient 사용.
// 좌표 없음/토큰 없음 → 조용히 no-op. chat.update 실패 → warn 후 swallow(best-effort).
@Injectable()
export class SlackPreviewCardUpdater implements PreviewCardPort {
  private readonly logger = new Logger(SlackPreviewCardUpdater.name);

  constructor(
    @Inject(PREVIEW_CARD_SLACK_CLIENT)
    private readonly client: WebClient | null,
  ) {}

  async update({
    preview,
    state,
    resultText,
  }: {
    preview: PreviewAction;
    state: PreviewCardState;
    resultText?: string;
  }): Promise<void> {
    if (!this.client) {
      return;
    }
    if (!preview.slackChannelId || !preview.slackMessageTs) {
      return;
    }
    const bodyText = resultText ?? preview.previewText;
    const blocks = buildResolvedPreviewBlocks({
      state,
      bodyText,
      previewId: preview.id,
    });
    try {
      await this.client.chat.update({
        channel: preview.slackChannelId,
        ts: preview.slackMessageTs,
        text: bodyText,
        blocks: blocks as never,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `PreviewCard chat.update 실패(swallow) preview=${preview.id} state=${state}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
