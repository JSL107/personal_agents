import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';

import {
  ART_JOB_POSTING_REPOSITORY_PORT,
  ArtJobPostingRepositoryPort,
} from '../../art-job-feed/domain/port/art-job-posting.repository.port';
import {
  ART_JOB_EXCLUDE_ACTION,
  ART_JOB_RESTORE_ACTION,
  buildArtJobItemButton,
  parseArtJobItemBlockId,
  SlackBlock,
} from '../../art-job-feed/infrastructure/art-job-feed.formatter';
import {
  extractActionMessageRef,
  extractActionUserId,
  extractActionValue,
} from '../bolt/action-body.parser';
import { SlackHandler } from '../domain/port/slack-handler.port';

interface ActionMessage {
  text?: string;
  blocks?: SlackBlock[];
}

// 원화 공고 본문의 「관심 없음」 / 「제외됨 · 되돌리기」 버튼. 받는 사람(ART_JOB_FEED_MENTION_USER_ID)의
// 클릭만 장부에 반영하고, 그 메시지의 버튼들을 장부 상태대로 다시 그린다.
//
// 실패는 조용히 넘기지 않는다 — 누른 사람은 반영됐다고 믿고 떠나므로 그 자리에서 알린다.
@Injectable()
export class ArtJobExclusionActionHandler implements SlackHandler {
  private readonly logger = new Logger(ArtJobExclusionActionHandler.name);
  // 메시지별 "조회 → 갱신" 줄. 한 본문에서 버튼 두 개를 연달아 누르면 두 갱신이 겹치고, 먼저 읽은
  // 오래된 상태가 나중에 도착해 앞 클릭의 표시를 덮는다(장부는 맞는데 화면이 틀린다).
  // ponytail: 프로세스 안 직렬화라 앱을 여러 개 띄우면 다시 겹칠 수 있다 — 그때는 메시지 단위 버전 검사로.
  private readonly redrawChains = new Map<string, Promise<void>>();

  constructor(
    private readonly configService: ConfigService,
    @Inject(ART_JOB_POSTING_REPOSITORY_PORT)
    private readonly repository: ArtJobPostingRepositoryPort,
  ) {}

  register(app: App): void {
    for (const actionId of [ART_JOB_EXCLUDE_ACTION, ART_JOB_RESTORE_ACTION]) {
      app.action(actionId, async ({ ack, body, respond, client }) => {
        await ack();
        const recipient = this.configService
          .get<string>('ART_JOB_FEED_MENTION_USER_ID')
          ?.trim();
        if (!recipient || extractActionUserId(body) !== recipient) {
          await respond({
            response_type: 'ephemeral',
            replace_original: false,
            text: '공고를 받는 사람만 누를 수 있어요.',
          });
          return;
        }
        const sourceId = extractActionValue(body);
        const messageRef = extractActionMessageRef(body);
        const message = (body as { message?: ActionMessage }).message;
        if (!sourceId || !messageRef || !message?.blocks) {
          this.logger.warn('원화 공고 버튼 해석 실패 — 값·메시지 좌표 누락');
          await respond({
            response_type: 'ephemeral',
            replace_original: false,
            text: '반영하지 못했어요 — 버튼 정보를 읽지 못했습니다.',
          });
          return;
        }
        const excluded = actionId === ART_JOB_EXCLUDE_ACTION;

        try {
          const found = await this.repository.setExcluded(sourceId, excluded);
          if (!found) {
            throw new Error(`장부에 없는 공고 — GI_No=${sourceId}`);
          }
          this.logger.log(
            `원화 공고 ${excluded ? '제외' : '제외 해제'} — GI_No=${sourceId}`,
          );
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.warn(`원화 공고 제외 저장 실패: ${reason}`);
          await respond({
            response_type: 'ephemeral',
            replace_original: false,
            text: '반영하지 못했어요. 잠시 뒤 다시 눌러 주세요.',
          });
          return;
        }

        // 저장은 끝났다. 다시 그리기가 실패해도 제외는 남아 있으므로 알리기만 한다.
        try {
          await this.serializeByMessage(messageRef.ts, async () => {
            const blocks = message.blocks ?? [];
            const sourceIds = blocks
              .map((block) => parseArtJobItemBlockId(block.block_id))
              .filter((id): id is string => id !== null);
            const excludedIds =
              await this.repository.findExcludedSourceIds(sourceIds);
            await client.chat.update({
              channel: messageRef.channel,
              ts: messageRef.ts,
              text: message.text ?? '',
              blocks: redrawButtons(blocks, excludedIds) as never,
            });
          });
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `원화 공고 본문 갱신 실패 (저장은 완료) — GI_No=${sourceId}: ${reason}`,
          );
          await respond({
            response_type: 'ephemeral',
            replace_original: false,
            text: '반영은 됐지만 버튼 표시를 바꾸지 못했어요.',
          });
        }
      });
    }
  }

  private serializeByMessage(
    messageTs: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const previous = this.redrawChains.get(messageTs) ?? Promise.resolve();
    const current = previous.then(task);
    // 앞 차례가 실패해도 뒤 차례는 돌아야 한다 — 줄에는 실패를 삼킨 꼬리만 남긴다.
    const tail = current.catch(() => undefined);
    this.redrawChains.set(messageTs, tail);
    void tail.then(() => {
      if (this.redrawChains.get(messageTs) === tail) {
        this.redrawChains.delete(messageTs);
      }
    });
    return current;
  }
}

// 공고 블록의 버튼만 장부 상태로 바꾸고 나머지 블록은 그대로 둔다.
export const redrawButtons = (
  blocks: SlackBlock[],
  excludedIds: Set<string>,
): SlackBlock[] => {
  return blocks.map((block) => {
    const sourceId = parseArtJobItemBlockId(block.block_id);
    if (!sourceId || !block.accessory) {
      return block;
    }
    return {
      ...block,
      accessory: buildArtJobItemButton(sourceId, excludedIds.has(sourceId)),
    };
  });
};
