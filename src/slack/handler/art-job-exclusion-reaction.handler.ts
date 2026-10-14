import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';

import { digestOrderFromReaction } from '../../art-job-feed/domain/art-job-exclusion';
import {
  ART_JOB_POSTING_REPOSITORY_PORT,
  ArtJobPostingRepositoryPort,
} from '../../art-job-feed/domain/port/art-job-posting.repository.port';
import { SlackHandler } from '../domain/port/slack-handler.port';

// 원화 공고 본문에 받는 사람(ART_JOB_FEED_MENTION_USER_ID)이 번호 이모지(1️⃣~🔟)를 달면
// 그 번호 공고를 장부에서 제외로 표시한다. 다음 회차부터 같은 회사 · 같은 제목은 보내지 않는다.
//
// 본문 조회 없이 장부의 (message_ts, digest_order) 로 되짚는다 — 채널을 ART_JOB_FEED_TARGET 으로
// 묶으므로 다른 메시지에 단 숫자 이모지는 장부에서 못 찾아 그냥 지나간다.
// reaction_removed 는 구독하지 않는다(다른 반응 핸들러와 동일) — 리액션을 지워도 제외는 풀리지 않는다.
@Injectable()
export class ArtJobExclusionReactionHandler implements SlackHandler {
  private readonly logger = new Logger(ArtJobExclusionReactionHandler.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(ART_JOB_POSTING_REPOSITORY_PORT)
    private readonly repository: ArtJobPostingRepositoryPort,
  ) {}

  register(app: App): void {
    const target = this.configService
      .get<string>('ART_JOB_FEED_TARGET')
      ?.trim();
    const recipient = this.configService
      .get<string>('ART_JOB_FEED_MENTION_USER_ID')
      ?.trim();
    // 받는 사람이 정해지지 않으면 누구의 리액션을 믿을지 모른다 — 아무도 제외하지 못하게 둔다.
    if (!target || !recipient) {
      return;
    }

    app.event('reaction_added', async ({ event }) => {
      const digestOrder = digestOrderFromReaction(event.reaction);
      if (digestOrder === null) {
        return;
      }
      if (event.item.type !== 'message' || event.item.channel !== target) {
        return;
      }
      if (event.user !== recipient) {
        return;
      }

      try {
        const excluded = await this.repository.markExcluded({
          messageTs: event.item.ts,
          digestOrder,
        });
        if (!excluded) {
          return;
        }
        this.logger.log(
          `원화 공고 제외 — ${digestOrder}번 ${excluded.company} / ${excluded.title}`,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `원화 공고 제외 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }
}
