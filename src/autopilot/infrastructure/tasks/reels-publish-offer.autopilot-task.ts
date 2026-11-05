import { homedir } from 'node:os';
import { join } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { scanReadyReels } from '../../../instagram/application/scan-ready-reels';
import { ReelPublishPayload } from '../../../instagram/domain/instagram-post.type';
import {
  INSTAGRAM_POST_REPOSITORY_PORT,
  InstagramPostRepositoryPort,
} from '../../../instagram/domain/port/instagram-post.repository.port';
import {
  META_GRAPH_PORT,
  MetaGraphPort,
} from '../../../instagram/domain/port/meta-graph.port';
import { CountPreviewsByPayloadUsecase } from '../../../preview-gate/application/count-previews-by-payload.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { escapeSlackMrkdwn } from '../../../slack/format/mrkdwn.util';
import {
  AutopilotPreviewRequest,
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const DEFAULT_OUT_ROOT = join(homedir(), 'Desktop', 'skill-jaengyi-reels');

@Injectable()
export class ReelsPublishOfferAutopilotTask implements AutopilotTask {
  readonly id = 'reels-publish-offer';

  constructor(
    @Inject(META_GRAPH_PORT) private readonly metaGraph: MetaGraphPort,
    @Inject(INSTAGRAM_POST_REPOSITORY_PORT)
    private readonly posts: InstagramPostRepositoryPort,
    private readonly countPreviews: CountPreviewsByPayloadUsecase,
    private readonly config: ConfigService,
  ) {}

  async run({
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    if (!this.metaGraph.isConfigured()) {
      return { skip: true };
    }
    const configuredRoot = this.config.get<string>('SKILL_REELS_OUT_ROOT');
    const outRoot = configuredRoot
      ? configuredRoot.replace(/^~(?=\/|$)/, homedir())
      : DEFAULT_OUT_ROOT;
    const scanned = await scanReadyReels({ outRoot, day: firedAtKst });
    const previews: AutopilotPreviewRequest[] = [];
    for (const reel of scanned.ready) {
      const [count, post] = await Promise.all([
        this.countPreviews.execute({
          kind: PREVIEW_KIND.INSTAGRAM_REEL_PUBLISH,
          payloadPath: ['reelKey'],
          payloadValue: reel.reelKey,
        }),
        this.posts.findByReelKey(reel.reelKey),
      ]);
      if (count > 0 || post !== null) {
        continue;
      }
      previews.push({
        kind: PREVIEW_KIND.INSTAGRAM_REEL_PUBLISH,
        payload: reel,
        previewText: formatPreview(reel),
      });
    }
    if (previews.length === 0 && scanned.tooLong.length === 0) {
      return { skip: true };
    }
    const summaryLines: string[] = [];
    if (previews.length > 0) {
      summaryLines.push(
        `스킬쟁이 릴스 ${previews.length}편 인스타 게시 승인을 기다립니다.`,
      );
    }
    for (const item of scanned.tooLong) {
      summaryLines.push(
        `게시 불가: ${item.reelKey} 캡션 ${item.captionChars}자(2,200자 초과)`,
      );
    }
    const keys = [
      ...previews.map(
        (preview) => `card:${(preview.payload as ReelPublishPayload).reelKey}`,
      ),
      ...scanned.tooLong.map((item) => `long:${item.reelKey}`),
    ];
    keys.sort();
    return {
      skip: false,
      summaryText: summaryLines.join('\n'),
      previews,
      guardKeySuffix: keys.join(','),
    };
  }
}

const formatPreview = (reel: ReelPublishPayload): string => {
  const field = reel.field === 'ai' ? 'AI' : '개발';
  const lines = [
    `📮 *인스타 공개 게시* · 「${escapeSlackMrkdwn(reel.title)}」 · @skill.jaengyi 에 바로 올라갑니다`,
    `분야 ${field} · ${Math.round(reel.durationSec)}초`,
    `영상: ${escapeSlackMrkdwn(reel.videoPath)}`,
    '✅ 적용을 누르면 바로 공개됩니다.',
    '',
    escapeSlackMrkdwn(reel.caption),
  ];
  return lines.join('\n');
};
