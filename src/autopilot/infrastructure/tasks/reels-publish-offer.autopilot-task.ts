import { homedir } from 'node:os';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { match } from 'ts-pattern';

import {
  getKstDateOf,
  kstDayStartOf,
} from '../../../common/util/kst-date.util';
import {
  PublishStoryUsecase,
  StoryPublishOutcome,
  StoryPublishResult,
} from '../../../instagram/application/publish-story.usecase';
import { scanReadyReels } from '../../../instagram/application/scan-ready-reels';
import {
  MarkerWriteResult,
  writePublishedMarker,
} from '../../../instagram/application/write-published-marker';
import { DEFAULT_SKILL_REELS_OUT_ROOT } from '../../../instagram/domain/instagram.constants';
import {
  InstagramPostField,
  InstagramPostStatus,
  ReelField,
  ReelPublishPayload,
} from '../../../instagram/domain/instagram-post.type';
import {
  INSTAGRAM_POST_REPOSITORY_PORT,
  InstagramPostRepositoryPort,
} from '../../../instagram/domain/port/instagram-post.repository.port';
import {
  META_GRAPH_PORT,
  MetaGraphPort,
} from '../../../instagram/domain/port/meta-graph.port';
import { parseReelPublishPayload } from '../../../instagram/domain/reel-publish-payload.parser';
import { CountPreviewsByPayloadUsecase } from '../../../preview-gate/application/count-previews-by-payload.usecase';
import { FindPreviewByIdUsecase } from '../../../preview-gate/application/find-preview-by-id.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { escapeSlackMrkdwn } from '../../../slack/format/mrkdwn.util';
import {
  AutopilotPreviewRequest,
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const KST_OFFSET_MS = 9 * 60 * 60_000;
// 이 task 의 마지막 슬롯(playbook `*/15 9-23`). 이때도 확정되지 않은 스토리 게시는 사람에게 넘긴다.
const LAST_SLOT_MINUTES = 23 * 60 + 45;
const MARKER_LOOKBACK_DAYS = 7;
const FIELD_LABELS: Record<ReelField, string> = {
  [InstagramPostField.AI]: 'AI',
  [InstagramPostField.DEV]: '개발',
  [InstagramPostField.DAILY]: 'AI·개발',
};

interface StoryStep {
  summaryLine: string | null;
  guardKey: string | null;
}

@Injectable()
export class ReelsPublishOfferAutopilotTask implements AutopilotTask {
  readonly id = 'reels-publish-offer';
  private readonly logger = new Logger(ReelsPublishOfferAutopilotTask.name);
  now = (): Date => new Date();

  constructor(
    @Inject(META_GRAPH_PORT) private readonly metaGraph: MetaGraphPort,
    @Inject(INSTAGRAM_POST_REPOSITORY_PORT)
    private readonly posts: InstagramPostRepositoryPort,
    private readonly countPreviews: CountPreviewsByPayloadUsecase,
    private readonly findPreview: FindPreviewByIdUsecase,
    private readonly publishStory: PublishStoryUsecase,
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
      : DEFAULT_SKILL_REELS_OUT_ROOT;
    const scanned = await scanReadyReels({ outRoot, day: firedAtKst });
    const cardPayloads: ReelPublishPayload[] = [];
    for (const reel of scanned.ready) {
      // 같은 영상(해시)으로 낸 카드가 있으면 상태와 상관없이 다시 내지 않는다. reelKey 로 세면 취소한 카드도
      // 세어져, 영상을 다시 만들어도 새 카드가 나오지 않았다(2026-11-05 교차 검토).
      const [count, post] = await Promise.all([
        this.countPreviews.execute({
          kind: PREVIEW_KIND.INSTAGRAM_REEL_PUBLISH,
          payloadPath: ['videoSha256'],
          payloadValue: reel.videoSha256,
        }),
        this.posts.findByReelKey(reel.reelKey),
      ]);
      if (count > 0 || post !== null) {
        continue;
      }
      cardPayloads.push(reel);
    }
    const previews: AutopilotPreviewRequest[] = cardPayloads.map((reel) => ({
      kind: PREVIEW_KIND.INSTAGRAM_REEL_PUBLISH,
      payload: reel,
      previewText: formatPreview(reel),
    }));
    // 전날 것도 본다. 23:45 마지막 슬롯 뒤나 다음 날 승인한 카드는 릴스만 올라가고 그 날짜를 다시 보는
    // 슬롯이 없어 스토리가 영영 남는다(2026-11-05 codex review). 카드 TTL 이 24시간이라 하루 전까지면 충분하다.
    const days = [previousKstDate(firedAtKst), firedAtKst];
    const stories = await Promise.all(
      days.map((day) => this.continueStory(day)),
    );
    // 표식은 최근 일주일을 본다. 이대리가 며칠 꺼져 있었어도 켜지면 빠진 날의 표식을 채운다(2026-11-05 codex review).
    for (const day of recentKstDates({
      day: firedAtKst,
      count: MARKER_LOOKBACK_DAYS,
    })) {
      await this.writeMarker(day);
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
    for (const story of stories) {
      if (story.summaryLine) {
        summaryLines.push(story.summaryLine);
      }
    }
    if (summaryLines.length === 0) {
      return { skip: true };
    }
    const keys = [
      // 영상 해시를 넣는다. 카드를 취소하고 다시 만든 영상은 같은 reelKey 라, 해시가 없으면 발송 가드가
      // "이미 보냄"으로 새 카드를 막는다(2026-11-05 codex review).
      ...cardPayloads.map(
        (payload) =>
          `card:${payload.reelKey}:${payload.videoSha256.slice(0, 12)}`,
      ),
      ...scanned.tooLong.map((item) => `long:${item.reelKey}`),
      ...stories.flatMap((story) => (story.guardKey ? [story.guardKey] : [])),
    ];
    keys.sort();
    const summaryText = summaryLines.join('\n');
    const guardKeySuffix = keys.join(',');
    return {
      skip: false,
      summaryText,
      previews,
      guardKeySuffix,
    };
  }

  // 그날 릴스가 게시됐고 그 카드가 스토리까지 승인했으면 스토리를 이어 올린다. 어떤 실패도 throw 하지 않는다.
  // 던지면 산출물 없는 슬롯이 실패 처리돼 60초 뒤 다시 돈다(autopilot.scheduler 재시도).
  private async continueStory(day: string): Promise<StoryStep> {
    const none: StoryStep = { summaryLine: null, guardKey: null };
    try {
      const reel = await this.posts.findByReelKey(`${day}/daily`);
      if (!reel || reel.status !== InstagramPostStatus.PUBLISHED) {
        return none;
      }
      const card = await this.findPreview.execute(reel.previewActionId);
      if (!card) {
        return none;
      }
      const { story } = parseReelPublishPayload(card.payload);
      if (!story) {
        return none;
      }
      const outcome = await this.publishStory.execute({
        day,
        reelPreviewId: reel.previewActionId,
        story,
        isLastSlot: this.isLastSlot(),
      });
      return describeStory({ day, outcome });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${day} 스토리 확인 실패: ${reason}`);
      return none;
    }
  }

  private async writeMarker(day: string): Promise<void> {
    try {
      const reel = await this.posts.findByReelKey(`${day}/daily`);
      if (!reel || reel.status !== InstagramPostStatus.PUBLISHED) {
        return;
      }
      const story = await this.posts.findByReelKey(`${day}/story`);
      const result = await writePublishedMarker({ reel, story });
      if (result.kind === MarkerWriteResult.SKIPPED) {
        this.logger.warn(`${day} 게시 표식 실패: ${result.reason}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${day} 게시 표식 실패: ${reason}`);
    }
  }

  private isLastSlot(): boolean {
    const kst = new Date(this.now().getTime() + KST_OFFSET_MS);
    const minutesOfDay = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    return minutesOfDay >= LAST_SLOT_MINUTES;
  }
}

// 알림은 상태가 바뀔 때 한 번만 나가게 상태별 발송 키를 단다(발송 가드는 같은 키를 하루 한 번만 보낸다).
// 실패는 다음 슬롯이 다시 하지만, 파일이 바뀐 경우처럼 계속 실패하면 그날 스토리가 조용히 빠지므로 하루 한 번 알린다.
const describeStory = ({
  day,
  outcome,
}: {
  day: string;
  outcome: StoryPublishOutcome;
}): StoryStep => {
  const step = match<StoryPublishOutcome, StoryStep>(outcome)
    .with({ kind: StoryPublishResult.PUBLISHED }, () => ({
      summaryLine: `${day} 「오늘의 한 줄」 스토리도 올라갔습니다.`,
      guardKey: `story:${day}:published`,
    }))
    .with({ kind: StoryPublishResult.UNCONFIRMED }, () => ({
      summaryLine: `${day} 스토리 게시 여부 확인 필요: 인스타 앱에서 스토리를 확인해 주세요(자동으로 다시 올리지 않습니다).`,
      guardKey: `story:${day}:unconfirmed`,
    }))
    .with({ kind: StoryPublishResult.FAILED }, ({ reason }) => ({
      summaryLine: `${day} 스토리 게시 실패: ${reason} (다음 조회에서 다시 시도합니다)`,
      guardKey: `story:${day}:failed`,
    }))
    .with(
      { kind: StoryPublishResult.LOCKED },
      { kind: StoryPublishResult.DONE },
      { kind: StoryPublishResult.PENDING },
      () => ({ summaryLine: null, guardKey: null }),
    )
    .exhaustive();
  return step;
};

// day 를 포함해 거꾸로 count 일. 오래된 날짜가 앞에 온다.
const recentKstDates = ({
  day,
  count,
}: {
  day: string;
  count: number;
}): string[] => {
  const dates = [day];
  while (dates.length < count) {
    dates.unshift(previousKstDate(dates[0]));
  }
  return dates;
};

const previousKstDate = (day: string): string => {
  const noonBefore = kstDayStartOf(day).getTime() - 12 * 60 * 60_000;
  return getKstDateOf(new Date(noonBefore));
};

const formatPreview = (reel: ReelPublishPayload): string => {
  const lines = [
    `📮 *인스타 공개 게시* · 「${escapeSlackMrkdwn(reel.title)}」 · @skill.jaengyi 에 바로 올라갑니다`,
    `분야 ${fieldLabel(reel)} · ${Math.round(reel.durationSec)}초`,
    `영상: ${escapeSlackMrkdwn(reel.videoPath)}`,
  ];
  if (reel.coverOffsetMs !== undefined) {
    lines.push(`표지: 영상 ${(reel.coverOffsetMs / 1000).toFixed(1)}초 지점`);
  }
  if (reel.story) {
    lines.push(
      '스토리(오늘의 한 줄 카드, 8초)도 이어서 올라갑니다.',
      `스토리: ${escapeSlackMrkdwn(reel.story.videoPath)}`,
    );
  }
  lines.push(
    '✅ 적용을 누르면 바로 공개됩니다.',
    '',
    escapeSlackMrkdwn(reel.caption),
  );
  return lines.join('\n');
};

// 하루 1편 카드는 실제로 들어간 꼭지만 적는다(한 꼭지만 나간 날은 그 분야만).
const fieldLabel = (reel: ReelPublishPayload): string => {
  if (!reel.segmentFields || reel.segmentFields.length === 0) {
    return FIELD_LABELS[reel.field];
  }
  const labels = reel.segmentFields.map((field) => FIELD_LABELS[field]);
  return labels.join('·');
};
