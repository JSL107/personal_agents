import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import {
  UNTRUSTED_INPUT_NOTICE,
  wrapUntrustedInput,
} from '../../common/llm/untrusted-input.util';
import { formatKstDate } from '../../common/util/kst-date.util';
import { extractJsonObjectText } from '../../common/util/llm-json-extract.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationMemoryService } from '../../router/application/conversation-memory.service';
import { ConversationTurn } from '../../router/domain/conversation-memory.type';
import { ConsoleTodo } from '../domain/briefing.type';
import { CONSOLE_CHANNEL_ID } from '../domain/console-conversation.constant';
import {
  MascotChatterResult,
  MascotChatterTrigger,
} from '../domain/mascot-chatter.type';
import { isNoteworthyRun } from '../domain/mascot-noteworthy';
import { WorkSuggestion } from '../domain/work-suggestion.type';
import { BuildPresidentBriefingUsecase } from './build-president-briefing.usecase';
import { ConsoleReadService } from './console-read.service';
import { SuggestNextWorkUsecase } from './suggest-next-work.usecase';

export const MASCOT_CHATTER_MAX_LENGTH = 80;
export const MASCOT_CHATTER_MAX_LENGTH_SUMMARY = 120;
const MEMORY_TEXT_MAX_LENGTH = 200;
// 장중 손절 점검처럼 잦은 내부 실행이 상한을 채워 사람이 볼 실행을 밀어내지 않도록 넉넉히 읽는다(행은 오류 200자뿐).
const FINISHED_RUN_LIMIT = 200;
const NOTEWORTHY_RUN_LIMIT = 6;
const PROGRESS_MIN_RUN_MS = 2 * 60_000;
const SINCE_MAX_AGE_MS = 24 * 60 * 60_000;
const MEMORY_TURN_LIMIT = 4;
const TODO_TARGET_LIMIT = 3;
const CHATTER_CONFIRM_TTL_MS = 5 * 60 * 1000;
const TIME_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const RUN_TIME_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface GenerateMascotChatterInput {
  declinedAgentTypes: string[];
  trigger: MascotChatterTrigger;
  since?: Date;
}

interface ChatterContext {
  conversationKey: string | null;
  todoLines: string[];
  turns: ConversationTurn[];
  candidates: readonly WorkSuggestion[];
}

interface RunContext {
  lines: string[];
  hasEvents: boolean;
  lookupFailed: boolean;
}

interface PendingChatter {
  chatterId: string;
  line: string;
  todoLines: string[];
  candidates: readonly WorkSuggestion[];
  conversationKey: string | null;
  createdAtMs: number;
}

@Injectable()
export class GenerateMascotChatterUsecase {
  private readonly logger = new Logger(GenerateMascotChatterUsecase.name);
  private readonly inFlight = new Map<
    MascotChatterTrigger,
    Promise<MascotChatterResult>
  >();
  private pendingChatter: PendingChatter | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly buildBriefing: BuildPresidentBriefingUsecase,
    private readonly conversationMemory: ConversationMemoryService,
    private readonly suggestNextWork: SuggestNextWorkUsecase,
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly consoleRead: ConsoleReadService,
  ) {}

  // 같은 계기의 동시 요청만 공유한다. 다른 계기는 각자의 실행 맥락을 읽어야 한다.
  execute(input: GenerateMascotChatterInput): Promise<MascotChatterResult> {
    // 호출마다 계기와 결과를 한 줄 남긴다. 없으면 "우사기가 조용하다" 를 두고 모델이 실패했는지, 말할 거리가
    // 없었는지, 앱이 아예 부르지 않았는지를 가를 수 없다(2026-10-22). 공유된 호출·예외로 끝난 호출도 남긴다.
    const pending = this.inFlight.get(input.trigger);
    if (pending) {
      this.logger.log(
        `우사기 한 마디 — 계기 ${input.trigger} · 진행 중인 요청 결과 공유`,
      );
      return pending;
    }
    const task = this.generate(input).then(
      (result) => {
        this.logger.log(
          `우사기 한 마디 — 계기 ${input.trigger} · ${result.reason ?? `성공 ${result.line?.length ?? 0}자`}${result.suggestion ? ' · 제안 있음' : ''}`,
        );
        return result;
      },
      (error: unknown) => {
        this.logger.warn(
          `우사기 한 마디 — 계기 ${input.trigger} · 예외 ${String(error)}`,
        );
        throw error;
      },
    );
    this.inFlight.set(input.trigger, task);
    const clearInFlight = (): void => {
      if (this.inFlight.get(input.trigger) === task) {
        this.inFlight.delete(input.trigger);
      }
    };
    void task.then(clearInFlight, clearInFlight);
    return task;
  }

  async confirmShown(chatterId: string): Promise<boolean> {
    const pending = this.pendingChatter;
    if (!pending || pending.chatterId !== chatterId) {
      return false;
    }
    this.pendingChatter = null;
    if (Date.now() - pending.createdAtMs >= CHATTER_CONFIRM_TTL_MS) {
      return false;
    }
    if (!pending.conversationKey) {
      return false;
    }
    try {
      await this.conversationMemory.appendTurn(pending.conversationKey, {
        role: 'assistant',
        text: withChatterSource({
          line: pending.line,
          todoLines: pending.todoLines,
          candidates: pending.candidates,
        }),
        agentType: null,
        agentRunId: null,
        timestampMs: Date.now(),
      });
      return true;
    } catch (error) {
      this.logger.warn(`우사기 대화 기억 저장 실패: ${String(error)}`);
      return false;
    }
  }

  private async generate(
    input: GenerateMascotChatterInput,
  ): Promise<MascotChatterResult> {
    const now = new Date();
    const runContext = await this.collectRunContext(input, now);
    if (runContext.lookupFailed) {
      return this.failure('CONTEXT_FAILED');
    }
    if (
      (input.trigger === 'EVENTS' || input.trigger === 'PROGRESS') &&
      runContext.lines.length === 0
    ) {
      return this.failure('NOTHING_TO_SAY');
    }
    const context = await this.collectContext(input);
    const prompt = [
      `현재 KST: ${formatKstDate(now.toISOString())} ${TIME_FORMATTER.format(now)}`,
      '다음은 현재 상황 자료다. 자료에 없는 일은 지어내지 마.',
      wrapUntrustedInput(
        [
          '[할 일]',
          ...context.todoLines,
          ...runContext.lines,
          '[최근 대화]',
          ...context.turns.map(
            (turn) =>
              `${turn.role === 'assistant' ? '우사기' : '사용자'}: ${stripChatterSource(turn.text).slice(0, MEMORY_TEXT_MAX_LENGTH)}`,
          ),
          '[제안 후보]',
          ...context.candidates.map(
            (candidate, index) =>
              `${index + 1}. ${candidate.displayName} (${candidate.agentType}): ${candidate.reason}`,
          ),
        ].join('\n'),
      ),
    ].join('\n\n');
    const systemPrompt = [
      '너는 macOS 콘솔의 마스코트 우사기다. 사용자에게 먼저 한 마디를 건넨다.',
      '짧고 밝은 반말(~야, ~해)을 쓰고 존댓말은 섞지 마. 우사기 소리(푸루루, 야하, 우라)는 가끔 문장 중간이나 끝에만 쓰고 첫머리에는 붙이지 마. 화면이 소리를 따로 붙인다.',
      input.trigger === 'EVENTS' || input.trigger === 'RETURN'
        ? '120자 이내의 한국어 한 문장만 써. 맥락에 없는 사실을 지어내지 마.'
        : '40자 안팎의 한국어 한 문장만 써. 맥락에 없는 사실을 지어내지 마.',
      '네가 작업을 실행하거나 실행하겠다고 약속하지 마. 제안은 사용자가 선택할 수 있게 물어보기만 해.',
      '제안 후보가 있고 문맥에 어울리면 그 번호를 suggestionIndex로 고를 수 있다. 고르지 않아도 된다.',
      '사용자에게 답을 묻는 질문형 문장이면 asks를 true로 설정해.',
      'JSON 객체 하나만 출력해: {"line": string, "suggestionIndex": number|null, "asks": boolean}.',
      this.triggerInstruction(input.trigger),
      UNTRUSTED_INPUT_NOTICE,
    ].join('\n');

    let responseText: string;
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.PM,
        request: { prompt, systemPrompt },
        noContractPreamble: true,
      });
      responseText = completion.text;
    } catch (error) {
      this.logger.warn(`우사기 한 마디 모델 실패: ${String(error)}`);
      return this.failure('MODEL_FAILED', runContext.hasEvents);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObjectText(responseText));
    } catch (error) {
      this.logger.warn(`우사기 한 마디 JSON 파싱 실패: ${String(error)}`);
      return this.failure('INVALID_JSON', runContext.hasEvents);
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return this.failure('INVALID_JSON', runContext.hasEvents);
    }
    const output = parsed as Record<string, unknown>;
    if (typeof output.line !== 'string') {
      return this.failure('INVALID_LINE', runContext.hasEvents);
    }
    const line = output.line.replace(/[\r\n]+/g, ' ').trim();
    const maxLength =
      input.trigger === 'EVENTS' || input.trigger === 'RETURN'
        ? MASCOT_CHATTER_MAX_LENGTH_SUMMARY
        : MASCOT_CHATTER_MAX_LENGTH;
    if (line.length === 0 || line.length > maxLength) {
      return this.failure('INVALID_LINE', runContext.hasEvents);
    }
    const index = output.suggestionIndex;
    const validIndex =
      typeof index === 'number' &&
      Number.isInteger(index) &&
      index >= 1 &&
      index <= context.candidates.length;
    if (index !== null && !validIndex) {
      this.logger.debug(`우사기 제안 index 무시: ${String(index)}`);
    }
    const suggestion = validIndex ? context.candidates[index - 1] : null;
    const chatterId = randomUUID();
    this.pendingChatter = {
      chatterId,
      line,
      todoLines: context.todoLines,
      candidates: context.candidates,
      conversationKey: context.conversationKey,
      createdAtMs: Date.now(),
    };
    return {
      chatterId,
      line,
      suggestion,
      asks: typeof output.asks === 'boolean' ? output.asks : false,
      hasEvents: runContext.hasEvents,
    };
  }

  private async collectRunContext(
    input: GenerateMascotChatterInput,
    now: Date,
  ): Promise<RunContext> {
    if (input.trigger === 'IDLE') {
      return { lines: [], hasEvents: false, lookupFailed: false };
    }
    try {
      if (input.trigger === 'PROGRESS') {
        const active = await this.agentRunService.findActiveRuns();
        const elapsedRuns = active.filter(
          (run) =>
            now.getTime() - run.startedAt.getTime() >= PROGRESS_MIN_RUN_MS,
        );
        if (elapsedRuns.length === 0) {
          return { lines: [], hasEvents: false, lookupFailed: false };
        }
        const names = await this.getDisplayNames();
        return {
          lines: elapsedRuns.slice(0, NOTEWORTHY_RUN_LIMIT).map((run) => {
            const minutes = Math.floor(
              (now.getTime() - run.startedAt.getTime()) / 60_000,
            );
            return `[진행 중] ${names.get(run.agentType) ?? run.agentType} ${minutes}분째`;
          }),
          hasEvents: false,
          lookupFailed: false,
        };
      }
      const proposedSince =
        input.since ?? new Date(now.getTime() - 30 * 60_000);
      const oldest = now.getTime() - SINCE_MAX_AGE_MS;
      const since =
        !Number.isFinite(proposedSince.getTime()) ||
        proposedSince.getTime() > now.getTime() ||
        proposedSince.getTime() < oldest
          ? new Date(oldest)
          : proposedSince;
      const finished = await this.agentRunService.findFinishedRunsSince({
        since,
        limit: FINISHED_RUN_LIMIT,
      });
      const noteworthy = finished
        .filter(isNoteworthyRun)
        .slice(0, NOTEWORTHY_RUN_LIMIT);
      if (noteworthy.length === 0) {
        return { lines: [], hasEvents: false, lookupFailed: false };
      }
      const names = await this.getDisplayNames();
      return {
        lines: noteworthy.map((run) => {
          const name = names.get(run.agentType) ?? run.agentType;
          const status = run.status === 'SUCCEEDED' ? '성공' : '실패';
          const summary = run.summary ? ` — ${run.summary}` : '';
          return `[끝난 일] ${name} ${status} ${RUN_TIME_FORMATTER.format(run.endedAt)}${summary}`;
        }),
        hasEvents: true,
        lookupFailed: false,
      };
    } catch (error) {
      this.logger.warn(`우사기 작업 맥락 조회 실패: ${String(error)}`);
      return { lines: [], hasEvents: false, lookupFailed: true };
    }
  }

  private async getDisplayNames(): Promise<Map<string, string>> {
    try {
      const snapshot = await this.consoleRead.getSnapshot();
      return new Map(
        snapshot.agents.map((agent) => [agent.agentType, agent.displayName]),
      );
    } catch (error) {
      this.logger.warn(`우사기 표시명 조회 실패: ${String(error)}`);
      return new Map();
    }
  }

  private triggerInstruction(trigger: MascotChatterTrigger): string {
    switch (trigger) {
      case 'EVENTS':
        return '끝난 일의 결과를 알려 줘. 여러 건이면 묶어서 한 마디로 말해.';
      case 'RETURN':
        return '다녀온 사용자에게 그사이 일을 짧게 요약해. 끝난 일이 없으면 짧게 인사해.';
      case 'PROGRESS':
        return '지금 하는 일을 짧게 알려 줘.';
      case 'IDLE':
        return '지금 맥락에 어울리는 짧은 한 마디를 건네.';
    }
  }

  private async collectContext(
    input: GenerateMascotChatterInput,
  ): Promise<ChatterContext> {
    const owner = this.config.get<string>('CONSOLE_OWNER_SLACK_USER_ID');
    const conversationKey = owner
      ? this.conversationMemory.buildKey({
          slackUserId: owner,
          channelId: CONSOLE_CHANNEL_ID,
        })
      : null;
    let todoLines: string[] = [];
    let candidates: readonly WorkSuggestion[] = [];
    try {
      const briefing = await this.buildBriefing.execute();
      todoLines = briefing.todos.slice(0, 3).map(formatTodoLine);
    } catch (error) {
      this.logger.warn(`우사기 브리핑 조회 실패: ${String(error)}`);
    }
    const recentTurns = conversationKey
      ? await this.readRecentTurns(conversationKey)
      : [];
    const turns = recentTurns.slice(-MEMORY_TURN_LIMIT);
    if (hasSuggestionSinceLastUserTurn(recentTurns)) {
      return { conversationKey, todoLines, turns, candidates };
    }
    try {
      const result = await this.suggestNextWork.execute();
      const declined = new Set(input.declinedAgentTypes);
      candidates = result.suggestions.filter(
        (suggestion) => !declined.has(suggestion.agentType),
      );
    } catch (error) {
      this.logger.warn(`우사기 제안 조회 실패: ${String(error)}`);
    }
    return { conversationKey, todoLines, turns, candidates };
  }

  private async readRecentTurns(
    conversationKey: string,
  ): Promise<ConversationTurn[]> {
    try {
      return await this.conversationMemory.getRecentTurns(conversationKey);
    } catch (error) {
      this.logger.warn(`우사기 대화 기억 조회 실패: ${String(error)}`);
      return [];
    }
  }

  private failure(
    reason: NonNullable<MascotChatterResult['reason']>,
    hasEvents = false,
  ): MascotChatterResult {
    return {
      chatterId: null,
      line: null,
      suggestion: null,
      asks: false,
      hasEvents,
      reason,
    };
  }
}

// 상세(며칠째)와 대상(repo #번호)까지 싣는다 — 'PR #3668 리뷰 회수' 만으로는 어느 레포의 무슨 지적인지
// 우사기도, 나중에 그 말을 되짚는 대화 답변도 설명하지 못한다.
// 대상은 전건이 오므로 몇 개만 싣는다. 다 실으면 기억 문장이 이전 발화 상한(1,500자)에 잘려 뒤쪽 할 일 근거가 사라진다.
const formatTodoLine = (todo: ConsoleTodo): string => {
  const detail = todo.detail ? ` (${todo.detail})` : '';
  const shown = todo.targets
    .slice(0, TODO_TARGET_LIMIT)
    .map((target) => target.label);
  const hidden = todo.targets.length - shown.length;
  const more = hidden > 0 ? ` 외 ${hidden}건` : '';
  const targets = shown.length > 0 ? ` — ${shown.join(', ')}${more}` : '';
  return `${todo.kind}: ${todo.label}${detail}${targets}`;
};

const CHATTER_SOURCE_PREFIX = '[이 한 마디를 만들 때 본 ';
const CANDIDATE_SOURCE_LABEL = '이 한 마디를 만들 때 본 제안 후보';

// 우사기 한 마디는 할 일·제안 후보를 보고 만든 문장인데 문장만 기억하면, 사용자가 "무슨 말이야?" 라고 되물을 때
// 대화 답변이 그 출처를 몰라 사과만 한다(2026-11-06 run 11773 할 일, 2026-11-17 "32일째인 Art Job Feed" 제안).
// 실제로 고른 근거라는 보장은 없으므로 "본 할 일·본 제안 후보" 로만 적는다. 모델은 index 없이 문장으로만 후보를
// 꺼내기도 해서 고른 후보만 남기면 빠진다. 기억은 화면에 다시 보이지 않고 프롬프트에만 쓰인다.
const withChatterSource = ({
  line,
  todoLines,
  candidates,
}: {
  line: string;
  todoLines: readonly string[];
  candidates: readonly WorkSuggestion[];
}): string => {
  const sources = [line];
  if (todoLines.length > 0) {
    sources.push(`[이 한 마디를 만들 때 본 할 일: ${todoLines.join(' / ')}]`);
  }
  if (candidates.length > 0) {
    const candidateLines = candidates.map(
      (candidate) =>
        `${candidate.displayName}(${candidate.agentType}) — ${candidate.reason}`,
    );
    sources.push(`[${CANDIDATE_SOURCE_LABEL}: ${candidateLines.join(' / ')}]`);
  }
  const memoryText = sources.join('\n');
  return memoryText;
};

// 출처 꼬리표는 대화 답변이 "무슨 말이야?" 에 답하라고 남긴 것이다. 우사기 자신의 [최근 대화]에 다시 실으면
// 후보를 비워도 지난 꼬리표에서 같은 제안을 다시 꺼낸다.
const stripChatterSource = (text: string): string => {
  const spokenLines = text
    .split('\n')
    .filter((textLine) => !textLine.startsWith(CHATTER_SOURCE_PREFIX));
  const spokenText = spokenLines.join('\n');
  return spokenText;
};

// 사용자가 답하기 전에 우사기가 제안 후보를 본 한 마디를 이미 했으면 이번엔 후보를 싣지 않는다. 직전 발화가
// [최근 대화]로 들어가 "~얘기는 했으니 ~도 볼까?" 로 제안을 하나씩 이어 붙였다(2026-11-17 콘솔).
// shortcut: 대화 기억(30분·5턴)과 표시 확인에 기대는 best-effort 억제다. 후보를 보고도 제안하지 않은 한 마디나
// 문장 없는 제안 수락(user 턴이 남지 않음)도 억제 쪽으로 센다. 엄격한 보장이 필요하면 제안 표시·응답 상태를 따로 둔다.
const hasSuggestionSinceLastUserTurn = (
  turns: readonly ConversationTurn[],
): boolean => {
  const lastUserIndex = turns.map((turn) => turn.role).lastIndexOf('user');
  const sinceUser = turns.slice(lastUserIndex + 1);
  const suggested = sinceUser.some(isCandidateSourceTurn);
  return suggested;
};

const isCandidateSourceTurn = (turn: ConversationTurn): boolean => {
  if (turn.role !== 'assistant') {
    return false;
  }
  const hasCandidateSource = turn.text.includes(`[${CANDIDATE_SOURCE_LABEL}:`);
  return hasCandidateSource;
};
