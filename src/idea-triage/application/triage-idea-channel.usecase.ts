import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { plainDateToIso } from '../../agent/vacation/domain/plain-date';
import { HolidayCalendar } from '../../holiday/domain/business-calendar';
import {
  HOLIDAY_CALENDAR_PORT,
  HolidayCalendarPort,
} from '../../holiday/domain/port/holiday-calendar.port';
import { CreatePreviewUsecase } from '../../preview-gate/application/create-preview.usecase';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../../preview-gate/domain/port/preview-action.repository.port';
import { PREVIEW_KIND } from '../../preview-gate/domain/preview-action.type';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../slack/domain/port/slack-notifier.port';
import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import { addPublicBusinessDays } from '../domain/idea-due-date';
import {
  EFFORT_BUSINESS_DAYS,
  IdeaEffort,
  IdeaVerdict,
} from '../domain/idea-triage.type';
import {
  IDEA_CHANNEL_READER_PORT,
  IdeaChannelMessage,
  IdeaChannelReaderPort,
} from '../domain/port/idea-channel-reader.port';
import {
  IDEA_TRIAGE_REPOSITORY_PORT,
  IdeaTriageRecord,
  IdeaTriageRepositoryPort,
} from '../domain/port/idea-triage.repository.port';
import { JudgeIdeaUsecase } from './judge-idea.usecase';

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_IDEAS_PER_RUN = 10;
const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const VERDICT_LABEL: Record<IdeaVerdict, string> = {
  BUILD: '만든다',
  REVISE_THEN_BUILD: '고치고 만든다',
  DROP: '접는다',
};

export interface IdeaTriageRunResult {
  skipped?: 'NOT_CONFIGURED' | 'SLACK_UNAVAILABLE';
  judged: number;
  posted: number;
  failed: number;
  byVerdict: Record<IdeaVerdict, number>;
}

export interface TriageIdeaChannelInput {
  ownerSlackUserId: string;
  firedAtKst: string;
}

@Injectable()
export class TriageIdeaChannelUsecase {
  private readonly logger = new Logger(TriageIdeaChannelUsecase.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(IDEA_CHANNEL_READER_PORT)
    private readonly channelReader: IdeaChannelReaderPort,
    @Inject(IDEA_TRIAGE_REPOSITORY_PORT)
    private readonly triageRepository: IdeaTriageRepositoryPort,
    @Inject(HOLIDAY_CALENDAR_PORT)
    private readonly holidayCalendar: HolidayCalendarPort,
    private readonly judgeIdea: JudgeIdeaUsecase,
    private readonly createPreview: CreatePreviewUsecase,
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly previewRepository: PreviewActionRepositoryPort,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
  ) {}

  async execute({
    ownerSlackUserId,
    firedAtKst,
  }: TriageIdeaChannelInput): Promise<IdeaTriageRunResult> {
    const result = emptyResult();
    const channelId = this.configService.get<string>('IDEA_CHANNEL_ID');
    if (!channelId) {
      return { ...result, skipped: 'NOT_CONFIGURED' };
    }
    const unposted = await this.triageRepository.findUnposted(channelId);
    for (const record of unposted) {
      await this.postIsolated(record, ownerSlackUserId, result);
    }

    const messages = await this.channelReader.listRecent(
      channelId,
      new Date(Date.now() - LOOKBACK_MS),
    );
    if (messages === null) {
      if (result.posted > 0 || result.failed > 0) {
        return result;
      }
      return { ...result, skipped: 'SLACK_UNAVAILABLE' };
    }

    const candidates = messages
      .filter(isCandidate)
      .sort((left, right) => Number(left.ts) - Number(right.ts));
    const found = new Set(
      await this.triageRepository.findExisting(
        channelId,
        candidates.map((message) => message.ts),
      ),
    );
    // ponytail: 한 회차의 LLM 비용을 10건으로 제한한다. 남은 글은 다음 회차에서 집는다.
    const selected: IdeaChannelMessage[] = [];
    for (const message of candidates) {
      if (found.has(message.ts)) {
        continue;
      }
      selected.push(message);
      found.add(message.ts);
      if (selected.length === MAX_IDEAS_PER_RUN) {
        break;
      }
    }
    let calendar: HolidayCalendar | null = null;
    const today = new Date(`${firedAtKst}T00:00:00.000Z`);
    for (const message of selected) {
      try {
        const outcome = await this.judgeIdea.execute({
          channelId,
          messageTs: message.ts,
          ideaText: message.text!.trim(),
        });
        const judgement = outcome.judgement;
        calendar ??= await this.holidayCalendar.load();
        const proposedDate = addPublicBusinessDays(
          today,
          EFFORT_BUSINESS_DAYS[judgement.effort],
          calendar,
        );
        // ponytail: insert 이전의 동시 판정은 가능하다. unique 충돌자는 게시하지 않는다.
        const record = await this.triageRepository.create({
          channelId,
          messageTs: message.ts,
          authorSlackUserId: message.user ?? null,
          ideaText: message.text!.trim(),
          verdict: judgement.verdict,
          reason: judgement.reason,
          counterpoint: judgement.counterpoint,
          scheduleTitle: judgement.scheduleTitle,
          effort: judgement.effort,
          proposedDate,
          agentRunId: outcome.agentRunId,
        });
        if (!record) {
          continue;
        }
        result.judged += 1;
        result.byVerdict[judgement.verdict] += 1;
        await this.post(record, ownerSlackUserId);
        result.posted += 1;
      } catch (error: unknown) {
        this.logger.error(
          '아이디어 판정 또는 게시 실패',
          error instanceof Error ? error.stack : String(error),
        );
        result.failed += 1;
      }
    }
    return result;
  }

  private async postIsolated(
    record: IdeaTriageRecord,
    ownerSlackUserId: string,
    result: IdeaTriageRunResult,
  ): Promise<void> {
    try {
      await this.post(record, ownerSlackUserId);
      result.posted += 1;
    } catch (error: unknown) {
      this.logger.error(
        '아이디어 게시 재시도 실패',
        error instanceof Error ? error.stack : String(error),
      );
      result.failed += 1;
    }
  }

  private async post(
    record: IdeaTriageRecord,
    ownerSlackUserId: string,
  ): Promise<void> {
    const verdict = record.verdict as IdeaVerdict;
    const effort = record.effort as IdeaEffort;
    const dateText = plainDateToIso(record.proposedDate);
    const lines = [
      `*판정: ${VERDICT_LABEL[verdict]}*`,
      escapeSlackMrkdwn(record.reason),
      `반박: ${escapeSlackMrkdwn(record.counterpoint)}`,
    ];
    if (verdict !== 'DROP') {
      lines.push(
        `제안 일정: ${dateText} (규모 ${effort} · ${EFFORT_BUSINESS_DAYS[effort]}영업일)`,
      );
    }
    let replyTs = record.replyTs;
    if (!replyTs) {
      const reply = await this.slackNotifier.postMessage({
        kind: 'idea-triage',
        target: record.channelId,
        threadTs: record.messageTs,
        text: lines.join('\n'),
      });
      if (!reply.ts) {
        throw new Error('아이디어 판정 답글의 Slack ts가 없습니다.');
      }
      replyTs = reply.ts;
      await this.triageRepository.markReplySent(record.id, replyTs);
    }
    if (verdict === 'DROP') {
      await this.triageRepository.markPosted(record.id, replyTs);
      return;
    }

    let permalink: string | null = null;
    try {
      permalink = await this.channelReader.getPermalink(
        record.channelId,
        record.messageTs,
      );
    } catch {
      // 퍼머링크 실패는 일정 제안을 막지 않는다.
    }
    const memo = [
      `판정: ${VERDICT_LABEL[verdict]}`,
      `이유: ${record.reason}`,
      ...(permalink ? [`원글: ${permalink}`] : []),
    ].join('\n');
    const payload = {
      ideaTriageId: record.id,
      title: record.scheduleTitle,
      dueDate: record.proposedDate,
      memo,
    };
    const previewText = `📅 ${dateText} 「${escapeSlackMrkdwn(record.scheduleTitle)}」 일정으로 등록할까요?`;
    let previewId = record.previewId;
    if (!previewId) {
      const preview = await this.createPreview.execute({
        slackUserId: ownerSlackUserId,
        kind: PREVIEW_KIND.IDEA_SCHEDULE,
        payload,
        previewText,
        ttlMs: PREVIEW_TTL_MS,
      });
      previewId = preview.id;
      await this.triageRepository.markPreviewCreated(record.id, previewId);
    }
    const savedPreview = await this.previewRepository.findById(previewId);
    if (!savedPreview?.slackMessageTs) {
      const coordinate = await this.slackNotifier.postPreviewMessage({
        target: record.channelId,
        threadTs: record.messageTs,
        preview: {
          id: previewId,
          kind: PREVIEW_KIND.IDEA_SCHEDULE,
          previewText,
          payload,
        },
      });
      await this.previewRepository.attachSlackMessage({
        id: previewId,
        slackChannelId: coordinate.channelId,
        slackMessageTs: coordinate.messageTs,
        slackThreadTs: record.messageTs,
      });
    }
    await this.triageRepository.markPosted(record.id, replyTs, previewId);
  }
}

const emptyResult = (): IdeaTriageRunResult => ({
  judged: 0,
  posted: 0,
  failed: 0,
  byVerdict: { BUILD: 0, REVISE_THEN_BUILD: 0, DROP: 0 },
});

const isCandidate = (message: IdeaChannelMessage): boolean =>
  (!message.threadTs || message.threadTs === message.ts) &&
  !message.subtype &&
  !message.botId &&
  Boolean(message.text?.trim());
