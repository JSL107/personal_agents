import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AGENT_REGISTRY } from '../../agent-registry/agent-registry';
import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { detectYesNoIntent } from '../../common/util/yes-no-intent.util';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ApplyPreviewUsecase } from '../../preview-gate/application/apply-preview.usecase';
import { CancelPreviewUsecase } from '../../preview-gate/application/cancel-preview.usecase';
import { FindLatestPendingPreviewUsecase } from '../../preview-gate/application/find-latest-pending-preview.usecase';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { ConversationMemoryService } from '../../router/application/conversation-memory.service';
import {
  ConversationalReplyFailedException,
  HandleConversationTurnUsecase,
} from '../../router/application/handle-conversation-turn.usecase';
import { buildDispatchReplyText } from '../../router/domain/dispatch-reply.util';
import { resolveChain } from '../domain/precondition-chain.map';
import { ConsoleEventBus } from './console-event-bus.service';
import { PendingConsoleTurnStore } from './pending-console-turn.store';
import { SuggestNextWorkUsecase } from './suggest-next-work.usecase';

const MAX_CHAIN_DEPTH = 3;
const DEFAULT_IMPACT_RECENT_DAYS = 7;
const CONSOLE_CHANNEL_ID = 'CONSOLE';
const CONSOLE_ANSWER_MAX_CHARS = 8000;
// 콘솔은 answered 전문을 별도 시트에서 열 수 있어, 화면을 보호하는 방어 상한만 유지한다.
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
    private readonly findLatestPendingPreview: FindLatestPendingPreviewUsecase,
    private readonly applyPreview: ApplyPreviewUsecase,
    private readonly cancelPreview: CancelPreviewUsecase,
  ) {}

  async run(input: ConsoleChainInput): Promise<void> {
    if (input.agentTypeHint === undefined && input.text) {
      const handled = await this.tryHandlePreviewYesNo(input);
      if (handled) {
        return;
      }
    }
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
          message: truncateConsoleAnswer(buildDispatchReplyText(result)),
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

  private async tryHandlePreviewYesNo(
    input: ConsoleChainInput,
  ): Promise<boolean> {
    // intent 판별이 먼저다 — 순수 함수라 공짜고, "응/아니" 가 아닌 대부분의 발화가
    // preview 저장소를 건드리지 않고 지나간다.
    const intent = detectYesNoIntent(input.text ?? '');
    if (intent === null) {
      return false;
    }
    // 조회 실패는 인터셉트 포기로 접는다 — preview 저장소 장애가 일반 콘솔 대화의
    // dispatch 까지 막으면 안 된다 (이 인터셉트는 있으면 좋은 지름길이지 관문이 아니다).
    let pending: PreviewAction | null;
    try {
      pending = await this.findLatestPendingPreview.execute({
        slackUserId: input.slackUserId,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `pending preview 조회 실패 — yes/no 인터셉트 없이 일반 dispatch 로 진행: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
    if (!pending) {
      return false;
    }
    if (pending.kind === PREVIEW_KIND.CAREER_JD_GAP_BLOG && intent === 'yes') {
      return false;
    }
    try {
      if (intent === 'yes') {
        const result = await this.applyPreview.execute({
          previewId: pending.id,
          slackUserId: input.slackUserId,
        });
        await this.rememberPreviewTurn(input, input.text ?? '');
        this.publishPreviewAnswer(
          input,
          `✅ 적용 완료 (${pending.kind})\n\n${result.resultText}`,
        );
      } else {
        await this.cancelPreview.execute({
          previewId: pending.id,
          slackUserId: input.slackUserId,
        });
        await this.rememberPreviewTurn(input, input.text ?? '');
        this.publishPreviewAnswer(input, `❌ 취소했습니다 (${pending.kind}).`);
      }
    } catch (error: unknown) {
      await this.rememberPreviewTurn(input, input.text ?? '');
      const action = intent === 'yes' ? '적용' : '취소';
      this.publishPreviewRejection(
        input,
        `Preview ${action} 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return true;
  }

  // 기억 기록은 부수 작업 — 여기서 throw 하면 이미 성공한 preview 적용/취소가
  // "실패" 로 발행되어 사용자가 재시도하게 된다 (HandleConversationTurnUsecase 의
  // appendRoundTripSafely 와 같은 원칙).
  private async rememberPreviewTurn(
    input: ConsoleChainInput,
    text: string,
  ): Promise<void> {
    try {
      const conversationKey = this.conversationMemory.buildKey({
        slackUserId: input.slackUserId,
        channelId: CONSOLE_CHANNEL_ID,
      });
      await this.conversationMemory.appendTurn(conversationKey, {
        role: 'user',
        text,
        agentType: null,
        agentRunId: null,
        timestampMs: Date.now(),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `preview 응답 turn 기억 실패 — 적용/취소 결과는 유지한다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private publishPreviewAnswer(
    input: ConsoleChainInput,
    message: string,
  ): void {
    if (input.commandId) {
      this.consoleEvents.publish({
        type: 'command.answered',
        commandId: input.commandId,
        message,
      });
    }
  }

  private publishPreviewRejection(
    input: ConsoleChainInput,
    reason: string,
  ): void {
    if (input.commandId) {
      this.consoleEvents.publish({
        type: 'command.rejected',
        commandId: input.commandId,
        reason,
      });
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
