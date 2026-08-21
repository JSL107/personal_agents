import { Inject, Injectable } from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationTurn } from '../domain/conversation-memory.type';
import {
  DispatchResult,
  DispatchSource,
  IDAERI_ROUTER_PORT,
  IdaeriRouterPort,
} from '../domain/idaeri-router.port';
import { RouterException } from '../domain/router.exception';
import { RouterErrorCode } from '../domain/router-error-code.enum';
import { ConversationMemoryService } from './conversation-memory.service';
import { ConversationalReplyUsecase } from './conversational-reply.usecase';

export interface HandleConversationTurnInput {
  slackUserId: string;
  conversationKey: string;
  text: string;
  source: DispatchSource;
  agentTypeHint?: AgentType;
  priorTurns?: ConversationTurn[];
  unresolvedStreak?: number;
  // 이 turn 을 대화 기억에 남길지. 체이닝으로 당겨 실행하는 선행 worker 는 false —
  // 사용자가 말하지도 보지도 않은 turn 이라, 남기면 5턴 한도에서 실제 발화를 밀어낸다.
  shouldRemember?: boolean;
}

export type HandleConversationTurnResult =
  | { kind: 'WORKER_RAN'; result: DispatchResult }
  | { kind: 'REPLIED'; text: string };

export class ConversationalReplyFailedException extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      cause instanceof Error ? cause.message : 'Conversational reply failed',
    );
    this.name = new.target.name;
    this.cause = cause;
  }
}

@Injectable()
export class HandleConversationTurnUsecase {
  constructor(
    @Inject(IDAERI_ROUTER_PORT)
    private readonly router: IdaeriRouterPort,
    private readonly conversationMemory: ConversationMemoryService,
    private readonly conversationalReply: ConversationalReplyUsecase,
  ) {}

  async execute(
    input: HandleConversationTurnInput,
  ): Promise<HandleConversationTurnResult> {
    const priorTurns =
      input.priorTurns ??
      (await this.conversationMemory.getRecentTurns(input.conversationKey));

    try {
      const result = await this.router.dispatch({
        source: input.source,
        slackUserId: input.slackUserId,
        text: input.text,
        agentTypeHint: input.agentTypeHint,
        priorTurns,
      });
      if (input.shouldRemember !== false) {
        await this.appendRoundTrip({
          conversationKey: input.conversationKey,
          userText: input.text,
          assistantText: result.formattedText,
          agentType: result.workerType,
          agentRunId: result.agentRunId,
        });
      }
      return { kind: 'WORKER_RAN', result };
    } catch (error: unknown) {
      if (!isIntentClassifyFailed(error)) {
        throw error;
      }

      let reply: string;
      try {
        reply = await this.conversationalReply.reply({
          text: input.text,
          priorTurns,
          unresolvedStreak: input.unresolvedStreak,
        });
      } catch (replyError: unknown) {
        throw new ConversationalReplyFailedException(replyError);
      }
      await this.appendRoundTrip({
        conversationKey: input.conversationKey,
        userText: input.text,
        assistantText: reply,
        agentType: null,
        agentRunId: null,
      });
      return { kind: 'REPLIED', text: reply };
    }
  }

  private async appendRoundTrip({
    conversationKey,
    userText,
    assistantText,
    agentType,
    agentRunId,
  }: {
    conversationKey: string;
    userText: string;
    assistantText: string;
    agentType: AgentType | null;
    agentRunId: number | null;
  }): Promise<void> {
    // agentTypeHint 로 지목된 dispatch (제안 번호 선택 등) 는 text 없이 온다. 빈 user turn 을
    // 남기면 분류기 prompt 에 빈 줄이 들어가고 5턴 한도의 한 칸을 먹는다.
    if (userText.trim().length > 0) {
      await this.conversationMemory.appendTurn(conversationKey, {
        role: 'user',
        text: userText,
        agentType,
        agentRunId,
        timestampMs: Date.now(),
      });
    }
    await this.conversationMemory.appendTurn(conversationKey, {
      role: 'assistant',
      text: assistantText,
      agentType,
      agentRunId,
      timestampMs: Date.now(),
    });
  }
}

const isIntentClassifyFailed = (error: unknown): boolean =>
  error instanceof RouterException &&
  error.routerErrorCode === RouterErrorCode.INTENT_CLASSIFY_FAILED;
