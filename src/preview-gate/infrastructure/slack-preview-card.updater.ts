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
      // 크기를 함께 남긴다. 2026-09-11 에 이 경로가 `msg_too_long` 으로 실패해 카드가
      // "⏳ 처리 중" 에 멈췄는데, 사후에 원인을 좁힐 수 없었다 — 저장된 previewText 는
      // 2,314 자(섹션 1 개)라 그 한도에 닿을 크기가 아니었고, 로그에는 실패 사실만 있어
      // "그 순간 무엇을 보냈는지" 를 되짚을 방법이 없었다. 길이·블록 수·출처(resultText 인지
      // previewText 인지)를 남겨 다음 발생 때 한 줄로 갈리게 한다.
      //
      // 상한을 걸어 미리 자르지 않는 이유: 지금 값으로는 재현되지 않아 어디를 잘라야 하는지
      // 모른다. 근거 없이 자르면 멀쩡한 승인 카드 본문이 사라진다.
      const blocksBytes = JSON.stringify(blocks).length;
      this.logger.warn(
        `PreviewCard chat.update 실패(swallow) preview=${preview.id} state=${state} ` +
          `본문=${bodyText.length}자 블록=${blocks.length}개 직렬화=${blocksBytes}B ` +
          `출처=${resultText === undefined ? 'previewText' : 'resultText'}: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }
}
