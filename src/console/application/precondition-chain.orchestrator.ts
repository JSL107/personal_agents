import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AGENT_REGISTRY } from '../../agent-registry/agent-registry';
import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationMemoryService } from '../../router/application/conversation-memory.service';
import {
  ConversationalReplyFailedException,
  HandleConversationTurnUsecase,
} from '../../router/application/handle-conversation-turn.usecase';
import { resolveChain } from '../domain/precondition-chain.map';
import { ConsoleEventBus } from './console-event-bus.service';
import { PendingConsoleTurnStore } from './pending-console-turn.store';
import { SuggestNextWorkUsecase } from './suggest-next-work.usecase';

const MAX_CHAIN_DEPTH = 3;
const DEFAULT_IMPACT_RECENT_DAYS = 7;
const CONSOLE_CHANNEL_ID = 'CONSOLE';
const CONSOLE_ANSWER_MAX_CHARS = 600;
// 콘솔 지시는 Slack message handler 의 say() 경로를 지나지 않아 전문이 Slack 에 게시되지
// 않는다. "전문은 Slack 에서" 는 없는 곳을 가리키는 거짓 안내였다. 전문 조회 경로 신설은 후속.
const CONSOLE_ANSWER_TRUNCATION_SUFFIX = '\n\n…(길어서 여기까지만 보여드려요)';
const SUGGESTION_FAILURE_MESSAGE =
  '지금 할 일을 추려보지 못했어요. 잠시 후 다시 말 걸어주세요.';

export interface ConsoleChainInput {
  slackUserId: string;
  text?: string;
  agentTypeHint?: AgentType;
  commandId?: string;
}

interface ChainState {
  depth: number;
  visited: AgentType[];
  path: string[];
}

type ChainOutcome = { ok: true } | { ok: false; reason: string };

// 콘솔 리모컨 2A.2 — 역방향 선행 트리거 오케스트레이터(REMOTE_CONSOLE 국한).
// precondition 예외는 LLM 호출 전에 발생하므로 실패한 dispatch 는 codex 를 쓰지 않는다.
@Injectable()
export class PreconditionChainOrchestrator {
  private readonly logger = new Logger(PreconditionChainOrchestrator.name);

  constructor(
    private readonly handleConversationTurn: HandleConversationTurnUsecase,
    private readonly conversationMemory: ConversationMemoryService,
    private readonly consoleEvents: ConsoleEventBus,
    private readonly config: ConfigService,
    private readonly suggestNextWork: SuggestNextWorkUsecase,
    private readonly pendingTurns: PendingConsoleTurnStore,
  ) {}

  async run(input: ConsoleChainInput): Promise<void> {
    await this.runChain(input, {
      depth: 0,
      visited: [],
      path: [String(input.agentTypeHint ?? input.text ?? '(자연어)')],
    });
  }

  private async runChain(
    input: ConsoleChainInput,
    chain: ChainState,
    shouldPublishWorkerAnswer = true,
  ): Promise<ChainOutcome> {
    try {
      const conversationKey = this.conversationMemory.buildKey({
        slackUserId: input.slackUserId,
        channelId: CONSOLE_CHANNEL_ID,
      });
      const outcome = await this.handleConversationTurn.execute({
        source: 'REMOTE_CONSOLE',
        slackUserId: input.slackUserId,
        conversationKey,
        text: input.text ?? '',
        agentTypeHint: input.agentTypeHint,
        // 선행 worker turn 은 기억하지 않는다 — 산출물을 사용자에게 보이지 않는 것과 같은 이유.
        shouldRemember: shouldPublishWorkerAnswer,
      });
      if (outcome.kind === 'REPLIED') {
        if (input.commandId) {
          this.consoleEvents.publish({
            type: 'command.answered',
            commandId: input.commandId,
            message: outcome.text,
          });
        }
        return { ok: true };
      }

      const result = outcome.result;
      if (input.commandId && result.autoResolvedNotice) {
        this.consoleEvents.publish({
          type: 'command.info',
          commandId: input.commandId,
          message: result.autoResolvedNotice,
        });
      }
      if (input.commandId && shouldPublishWorkerAnswer) {
        this.consoleEvents.publish({
          type: 'command.answered',
          commandId: input.commandId,
          message: truncateConsoleAnswer(result.formattedText),
        });
      }
      return { ok: true };
    } catch (error: unknown) {
      if (error instanceof ConversationalReplyFailedException) {
        return await this.answerWithSuggestions(input, chain);
      }
      if (!(error instanceof DomainException)) {
        const reason = error instanceof Error ? error.message : String(error);
        return this.reject(input, chain, reason);
      }
      const resolution = resolveChain(error.errorCode);
      if (!resolution || resolution.kind === 'UNRESOLVABLE') {
        const agentTypeHint = input.agentTypeHint;
        // agentTypeHint가 있는데 text 없이 발생한 BAD_REQUEST는 worker 입력 부족으로 해석한다.
        if (
          agentTypeHint !== undefined &&
          (input.text === undefined || input.text.trim().length === 0) &&
          error.status === DomainStatus.BAD_REQUEST
        ) {
          return this.askForInput(input, agentTypeHint, error);
        }
        return this.reject(input, chain, error.message);
      }
      if (chain.visited.includes(resolution.prereqWorker)) {
        return this.reject(
          input,
          chain,
          `순환 감지: ${resolution.prereqWorker} 재진입`,
        );
      }
      if (chain.depth + 1 > MAX_CHAIN_DEPTH) {
        return this.reject(input, chain, '자동 체이닝 깊이 초과');
      }
      if (input.commandId) {
        this.consoleEvents.publish({
          type: 'command.info',
          commandId: input.commandId,
          message: `${resolution.failedWorkerLabel} 실행에 필요한 ${resolution.prereqWorker} 선행이 없어 먼저 실행합니다.`,
        });
      }
      const prereqInput: ConsoleChainInput = {
        slackUserId: input.slackUserId,
        agentTypeHint: resolution.prereqWorker,
        text: resolution.needsRecentArg
          ? `--recent ${this.impactRecentDays()}d`
          : undefined,
        commandId: input.commandId,
      };
      const nextChain: ChainState = {
        depth: chain.depth + 1,
        visited: [...chain.visited, resolution.prereqWorker],
        path: [...chain.path, resolution.prereqWorker],
      };
      const prereqOutcome = await this.runChain(prereqInput, nextChain, false);
      if (!prereqOutcome.ok) {
        return prereqOutcome;
      }
      return this.runChain(input, nextChain, true);
    }
  }

  private async answerWithSuggestions(
    input: ConsoleChainInput,
    chain: ChainState,
  ): Promise<ChainOutcome> {
    try {
      const result = await this.suggestNextWork.execute();
      this.logger.log(
        `콘솔 할 일 제안 계산 — ${result.suggestions.length}개 제안, 주기 미상 ${result.skippedUnknownCycle}개 제외`,
      );
      if (result.suggestions.length === 0) {
        return this.reject(
          input,
          chain,
          '지금 새로 시킬 만한 일을 찾지 못했습니다.',
        );
      }

      this.pendingTurns.putSuggestions(input.slackUserId, result.suggestions);
      if (input.commandId) {
        const suggestionLines = result.suggestions.map(
          (suggestion, index) =>
            `${index + 1}. ${suggestion.displayName} — ${suggestion.reason}`,
        );
        const alsoDueLine =
          result.alsoDueCount > 0
            ? [`그 외 ${result.alsoDueCount}개도 때가 됐어요.`]
            : [];
        this.consoleEvents.publish({
          type: 'command.answered',
          commandId: input.commandId,
          message: [
            '지금 시킬 만한 일이에요. 번호로 답해주세요.',
            ...suggestionLines,
            ...alsoDueLine,
          ].join('\n'),
        });
      }
      return { ok: false, reason: '제안 제시' };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`콘솔 할 일 제안 실패 — ${reason}`);
      return this.reject(input, chain, SUGGESTION_FAILURE_MESSAGE, false);
    }
  }

  private askForInput(
    input: ConsoleChainInput,
    agentType: AgentType,
    error: DomainException,
  ): ChainOutcome {
    const displayName =
      AGENT_REGISTRY.find((entry) => entry.agentType === agentType)
        ?.displayName ?? String(agentType);
    this.logger.log(`콘솔 worker 입력 요청 — ${agentType}: ${error.message}`);
    this.pendingTurns.putAwaitingInput(input.slackUserId, {
      agentType,
      displayName,
    });
    if (input.commandId) {
      this.consoleEvents.publish({
        type: 'command.answered',
        commandId: input.commandId,
        message: `「${displayName}」에 무엇을 맡길지 한 줄로 알려주세요. 적어주시면 그대로 시작할게요. (지금 적는 말은 ${displayName} 에게 그대로 전달됩니다)`,
      });
    }
    return { ok: false, reason: '입력 요청' };
  }

  private reject(
    input: ConsoleChainInput,
    chain: ChainState,
    reason: string,
    shouldLog = true,
  ): ChainOutcome {
    const path = chain.path.join(' ← ');
    if (shouldLog) {
      this.logger.warn(`콘솔 체이닝 중단 — ${path}: ${reason}`);
    }
    if (input.commandId) {
      this.consoleEvents.publish({
        type: 'command.rejected',
        commandId: input.commandId,
        reason: `${path}: ${reason}`,
      });
    }
    return { ok: false, reason };
  }

  private impactRecentDays(): number {
    const raw = this.config.get<string>('CONSOLE_CHAIN_IMPACT_RECENT_DAYS');
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_IMPACT_RECENT_DAYS;
  }
}

const truncateConsoleAnswer = (text: string): string =>
  text.length > CONSOLE_ANSWER_MAX_CHARS
    ? `${text.slice(0, CONSOLE_ANSWER_MAX_CHARS)}${CONSOLE_ANSWER_TRUNCATION_SUFFIX}`
    : text;
