import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import {
  ArtJobKeywordKind,
  ArtJobKeywordSet,
} from '../../art-job-feed/domain/art-job-keyword';
import {
  ART_JOB_KEYWORD_REPOSITORY_PORT,
  ArtJobKeywordRepositoryPort,
} from '../../art-job-feed/domain/port/art-job-keyword.repository.port';
import { readArtJobFeedJobData } from '../../art-job-feed-cron/application/art-job-feed-job-data';
import {
  ART_JOB_FEED_CRON_QUEUE,
  ArtJobFeedRunResult,
} from '../../art-job-feed-cron/domain/art-job-feed-cron.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  ART_JOB_WRITE_VERBS,
  findHypotheticalMarker,
  formatHeldWrite,
} from '../../router/domain/hypothetical-utterance';
import { DispatchInput } from '../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../router/domain/port/agent-dispatcher.port';
import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import {
  ArtJobFeedCommand,
  mergeArtJobFeedCommands,
  parseArtJobFeedCommand,
} from '../domain/parse-art-job-feed-command';

const LIST_LABEL: Record<ArtJobKeywordKind, string> = {
  TARGET: '허용(제목에 있으면 받기)',
  EXCLUDED: '제외(제목에 있으면 거르기)',
  STYLE: '화풍(태그만)',
};

@Injectable()
export class ArtJobFeedDispatcher implements AgentDispatcher, OnModuleDestroy {
  readonly agentType = AgentType.ART_JOB_FEED;
  private queueEvents?: QueueEvents;

  constructor(
    @Inject(ART_JOB_KEYWORD_REPOSITORY_PORT)
    private readonly keywords: ArtJobKeywordRepositoryPort,
    @InjectQueue(ART_JOB_FEED_CRON_QUEUE)
    private readonly queue: Queue,
    private readonly configService: ConfigService,
    private readonly agentRunService: AgentRunService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.queueEvents?.close();
  }

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const jobData = readArtJobFeedJobData(this.configService);
    if (jobData === null) {
      return this.reply({ kind: 'UNKNOWN' }, '원화 공고 피드가 꺼져 있어요.');
    }

    const current = parseArtJobFeedCommand(input.text ?? '');
    const prior = [...(input.priorTurns ?? [])]
      .reverse()
      .find(
        (turn) =>
          turn.agentType === AgentType.ART_JOB_FEED &&
          (turn.role ?? 'user') === 'user' &&
          turn.text.trim().length > 0,
      );
    const priorCommand =
      prior === undefined ? null : parseArtJobFeedCommand(prior.text);
    const command =
      priorCommand === null
        ? current
        : mergeArtJobFeedCommands(priorCommand, current, input.text ?? '');
    const mergedPriorText = command !== current ? prior?.text : undefined;

    if (command.kind === 'UNKNOWN') {
      const keywords = await this.keywords.load();
      return this.reply(
        command,
        `원화 공고 키워드는 허용·제외·화풍 목록을 조회·변경할 수 있고, 원화 공고 채널에서 "공고 가져와"라고 하면 새 공고를 올려요.\n${this.formatLists(keywords)}`,
      );
    }
    if (command.kind === 'LIST') {
      const keywords = await this.keywords.load();
      return this.reply(command, this.formatLists(keywords, command.listKind));
    }

    if (
      command.kind === 'ADD' ||
      command.kind === 'REMOVE' ||
      command.kind === 'FETCH'
    ) {
      const marker =
        findHypotheticalMarker(input.text ?? '', ART_JOB_WRITE_VERBS) ??
        (mergedPriorText === undefined
          ? null
          : findHypotheticalMarker(mergedPriorText, ART_JOB_WRITE_VERBS));
      if (marker !== null) {
        const keywords = await this.keywords.load();
        const action =
          command.kind === 'FETCH' ? '공고를 게시' : '키워드를 변경';
        return this.reply(
          command,
          `${formatHeldWrite(action, command.kind === 'FETCH' ? '공고 가져와' : '화풍에 북미풍 추가해줘')}\n허용·제외·화풍 키워드를 관리하고 새 공고를 받을 수 있어요.\n${this.formatLists(keywords)}`,
        );
      }
    }

    if (command.kind === 'NEEDS_LIST') {
      return this.reply(
        command,
        // 뽑은 키워드를 그대로 보여 준다 — 잘못 뽑혔으면 답하기 전에 사용자가 알아챈다.
        `${this.formatTerms(command.terms)} 키워드를 「허용(제목에 있으면 받기) / 제외(제목에 있으면 거르기) / 화풍(태그만)」 중 한 곳을 골라 주세요. 한 번에 한 목록에만 ${command.action === 'ADD' ? '추가' : '제거'}해요. 예: "화풍에 추가"`,
      );
    }
    if (command.kind === 'NEEDS_TERMS') {
      return this.reply(
        command,
        `${command.listKind ? LIST_LABEL[command.listKind] : '어느 목록'}에 ${command.action === 'ADD' ? '추가' : '제거'}할 키워드를 알려 주세요.`,
      );
    }

    if (input.replyContext?.channel !== jobData.target) {
      return this.reply(
        command,
        `키워드 변경과 공고 가져오기는 원화 공고 채널(<#${jobData.target}>)에서 말해 주세요.`,
      );
    }

    if (command.kind === 'FETCH') {
      const outcome = await this.agentRunService.execute({
        agentType: AgentType.ART_JOB_FEED,
        triggerType: TriggerType.SLACK_MENTION_ART_JOB_FEED,
        inputSnapshot: { slackUserId: input.slackUserId, action: command.kind },
        run: async () => {
          const result = await this.fetch(jobData);
          return { result, output: result, modelUsed: 'deterministic' };
        },
      });
      const note =
        command.terms.length > 0
          ? `\n${this.formatFetchTermsNote(command.terms, await this.keywords.load())}`
          : '';
      return {
        agentRunId: outcome.agentRunId,
        output: outcome.result,
        modelUsed: outcome.modelUsed,
        formattedText: `${this.formatFetch(outcome.result)}${note}`,
      };
    }

    const outcome = await this.agentRunService.execute({
      agentType: AgentType.ART_JOB_FEED,
      triggerType: TriggerType.SLACK_MENTION_ART_JOB_FEED,
      inputSnapshot: {
        slackUserId: input.slackUserId,
        action: command.kind,
        listKind: command.listKind,
        terms: command.terms,
      },
      run: async () => {
        const change =
          command.kind === 'ADD'
            ? await this.keywords.add(
                command.listKind,
                command.terms,
                input.slackUserId,
              )
            : await this.keywords.remove(
                command.listKind,
                command.terms,
                input.slackUserId,
              );
        const keywords = await this.keywords.load();
        const result = { change, keywords };
        return { result, output: result, modelUsed: 'deterministic' };
      },
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: this.formatChange(command, outcome.result),
    };
  }

  private async fetch(jobData: {
    target: string;
    mentionUserId: string | null;
    ownerSlackUserId: string | null;
  }): Promise<ArtJobFeedRunResult | { kind: 'TIMEOUT' }> {
    this.queueEvents ??= new QueueEvents(this.queue.name, {
      connection: this.queue.opts.connection,
    });
    const job = await this.queue.add(
      'art-job-feed-manual',
      { ...jobData, trigger: 'MANUAL' },
      {
        attempts: 1,
        removeOnComplete: 20,
        removeOnFail: 20,
      },
    );
    try {
      return (await job.waitUntilFinished(
        this.queueEvents,
        5 * 60_000,
      )) as ArtJobFeedRunResult;
    } catch (error) {
      if (
        error instanceof Error &&
        /Job wait .* timed out before finishing/i.test(error.message)
      ) {
        return { kind: 'TIMEOUT' };
      }
      throw error;
    }
  }

  private formatFetch(
    result: ArtJobFeedRunResult | { kind: 'TIMEOUT' },
  ): string {
    switch (result.kind) {
      case 'POSTED':
        return `새 공고 ${result.count}건을 채널에 올렸어요.`;
      case 'NO_NEW':
        return '지금은 새 원화 공고가 없어요(이미 올린 공고·제외한 공고는 다시 보내지 않아요).';
      case 'SLOT_TAKEN':
        return '같은 요청이 이미 처리됐어요.';
      case 'TIMEOUT':
        return '아직 가져오는 중이에요. 끝나면 채널에 바로 올라와요.';
    }
  }

  // 「[캐주얼 / 북미풍] 관련 공고 찾아줘」 — 가져오기는 저장된 허용 키워드로 거르므로, 말한 키워드가
  // 실제로 어떻게 쓰이는지 알려 준다. 말한 키워드로 따로 찾는다고 오해하지 않게 한다.
  private formatFetchTermsNote(
    terms: string[],
    keywords: ArtJobKeywordSet,
  ): string {
    const has = (list: string[], term: string): boolean =>
      list.some((known) => known.toLowerCase() === term.toLowerCase());
    // 제외가 먼저다 — 제외어가 하나라도 맞으면 허용 목록에 있어도 걸러진다(isTargetArtRole, #850 리뷰).
    const excluded = terms.filter((term) => has(keywords.excluded, term));
    const rest = terms.filter((term) => !has(keywords.excluded, term));
    const target = rest.filter((term) => has(keywords.target, term));
    const styleOnly = rest.filter(
      (term) => !has(keywords.target, term) && has(keywords.style, term),
    );
    const missing = rest.filter(
      (term) => !has(keywords.target, term) && !has(keywords.style, term),
    );
    const lines = ['공고는 저장된 허용 키워드로 골라요.'];
    if (excluded.length > 0) {
      lines.push(
        `제외 목록에 있어 걸러짐: ${this.formatTerms(excluded)} — 받으려면 "제외에서 ${excluded[0]} 빼줘"처럼 말해 주세요.`,
      );
    }
    if (target.length > 0) {
      lines.push(`허용 목록에 있음: ${this.formatTerms(target)}`);
    }
    if (styleOnly.length > 0) {
      lines.push(
        `화풍 태그로만 씀(거르지 않고 🎨 태그): ${this.formatTerms(styleOnly)}`,
      );
    }
    if (missing.length > 0) {
      lines.push(
        `목록에 없음: ${this.formatTerms(missing)} — 받으려면 "허용에 ${missing[0]} 추가해줘"처럼 말해 주세요.`,
      );
    }
    return lines.join('\n');
  }

  private formatChange(
    command: Extract<ArtJobFeedCommand, { kind: 'ADD' | 'REMOVE' }>,
    result: {
      change: {
        added?: string[];
        existing?: string[];
        removed?: string[];
        missing?: string[];
      };
      keywords: ArtJobKeywordSet;
    },
  ): string {
    const changed =
      command.kind === 'ADD'
        ? (result.change.added ?? [])
        : (result.change.removed ?? []);
    const unchanged =
      command.kind === 'ADD'
        ? (result.change.existing ?? [])
        : (result.change.missing ?? []);
    const verb = command.kind === 'ADD' ? '추가' : '제거';
    const status = command.kind === 'ADD' ? '이미 있음' : '없음';
    const warning =
      command.kind === 'REMOVE' && result.keywords.target.length === 0
        ? '\n⚠️ 허용 키워드가 비어서 제목 필터를 통과할 공고가 없어요.'
        : '';
    return `${LIST_LABEL[command.listKind]} ${verb}: ${this.formatTerms(changed)} / ${status}: ${this.formatTerms(unchanged)}\n${this.formatLists(result.keywords, command.listKind)}\n다음 수집 회차부터 적용돼요.${warning}`;
  }

  private formatLists(
    keywords: ArtJobKeywordSet,
    only?: ArtJobKeywordKind,
  ): string {
    const rows: [ArtJobKeywordKind, string[]][] = [
      ['TARGET', keywords.target],
      ['EXCLUDED', keywords.excluded],
      ['STYLE', keywords.style],
    ];
    return rows
      .filter(([kind]) => only === undefined || only === kind)
      .map(([kind, terms]) => `${LIST_LABEL[kind]}: ${this.formatTerms(terms)}`)
      .join('\n');
  }

  private formatTerms(terms: string[]): string {
    return terms.length === 0
      ? '없음'
      : terms.map(escapeSlackMrkdwn).join(', ');
  }

  private reply(output: unknown, formattedText: string): DispatchOutcome {
    return { agentRunId: 0, output, modelUsed: 'deterministic', formattedText };
  }
}
