import { Inject, Injectable, Logger } from '@nestjs/common';
import { App, SayFn } from '@slack/bolt';
import { WebClient } from '@slack/web-api';

import { ConversationMemoryService } from '../../router/application/conversation-memory.service';
import { ConversationalReplyUsecase } from '../../router/application/conversational-reply.usecase';
import {
  DispatchResult,
  IDAERI_ROUTER_PORT,
  IdaeriRouterPort,
} from '../../router/domain/idaeri-router.port';
import { RouterException } from '../../router/domain/router.exception';
import { RouterErrorCode } from '../../router/domain/router-error-code.enum';
import { SlackHandler } from '../domain/port/slack-handler.port';
import { toUserFacingErrorMessage } from './slack-handler.helper';

// 사용자 메시지 위에 진행 단계 reaction 으로 시각 피드백.
//   :eyes:               (수신 직후) — 봇이 메시지를 읽었음
//   :hourglass:          (dispatch 직전) — LLM 처리 중. 완료 시 제거 (성공/실패 무관).
//   :white_check_mark:   (성공 직후) — worker dispatch / conversational fallback 모두 OK 인 경우
const REACTION_ACK = 'eyes';
const REACTION_PROCESSING = 'hourglass';
const REACTION_SUCCESS = 'white_check_mark';

// V3 비전 봇 쪼개기 — 자연어 진입 surface.
// 두 종류 trigger:
//   1. app_mention: 채널/그룹/MPIM 에서 bot 멘션 (`<@BOT_ID> ...`). prefix 제거 후 router.
//   2. message (channel_type='im'): DM 1:1 메시지. 멘션 prefix 없이 전체 text 가 router 입력.
// 둘 다 동일 IdaeriRouterPort.dispatch 호출 + handoff chain 의 전체 worker formatter 를
// `---` 로 결합한 답글 노출.
//
// multi-turn 메모리 — ConversationMemoryService 가 사용자별 (slackUserId+channelId) 최근 5 turn
// 보존 (TTL 30분). 매 dispatch 전 prior turns 를 가져와 IntentClassifier 의 분류 정확도 ↑ +
// 직전 worker 의 agentRunId 를 contextRefs.agentRunId 로 자동 전달 (예: PM → CTO 자연어 chain).
//
// C-4 Phase 10 — registerRouterMessageHandler fn → @Injectable() class (C-4 완결).
@Injectable()
export class RouterMessageHandler implements SlackHandler {
  private readonly logger = new Logger(RouterMessageHandler.name);

  constructor(
    @Inject(IDAERI_ROUTER_PORT)
    private readonly idaeriRouter: IdaeriRouterPort,
    private readonly conversationMemory: ConversationMemoryService,
    private readonly conversationalReply: ConversationalReplyUsecase,
  ) {}

  register(app: App): void {
    app.event('app_mention', async ({ event, say, client }) => {
      const rawText =
        'text' in event && typeof event.text === 'string' ? event.text : '';
      const slackUserId =
        'user' in event && typeof event.user === 'string'
          ? event.user
          : 'unknown';
      const channelId =
        'channel' in event && typeof event.channel === 'string'
          ? event.channel
          : 'unknown';
      const threadTs =
        'thread_ts' in event && typeof event.thread_ts === 'string'
          ? event.thread_ts
          : event.ts;
      const messageTs = event.ts;

      await this.processRouterMessage({
        text: stripMentionPrefix(rawText),
        slackUserId,
        channelId,
        threadTs,
        messageTs,
        say,
        client,
        source: 'app_mention',
      });
    });

    // DM (channel_type='im') 진입. subtype 없는 user message 만 — bot 자신의 메시지 / edit /
    // delete event 등은 필터 (무한 루프 방지). 멘션 prefix 처리 X (DM 은 1:1 이라 멘션 없음).
    app.event('message', async ({ event, say, client }) => {
      if (!('channel_type' in event) || event.channel_type !== 'im') {
        return;
      }
      if ('subtype' in event && event.subtype !== undefined) {
        return;
      }
      if ('bot_id' in event && event.bot_id) {
        return;
      }

      const rawText =
        'text' in event && typeof event.text === 'string' ? event.text : '';
      const slackUserId =
        'user' in event && typeof event.user === 'string'
          ? event.user
          : 'unknown';
      const channelId =
        'channel' in event && typeof event.channel === 'string'
          ? event.channel
          : 'unknown';
      const messageTs =
        'ts' in event && typeof event.ts === 'string' ? event.ts : undefined;
      const threadTs =
        'thread_ts' in event && typeof event.thread_ts === 'string'
          ? event.thread_ts
          : messageTs;

      await this.processRouterMessage({
        text: rawText.trim(),
        slackUserId,
        channelId,
        threadTs,
        messageTs,
        say,
        client,
        source: 'dm',
      });
    });
  }

  private async processRouterMessage({
    text,
    slackUserId,
    channelId,
    threadTs,
    messageTs,
    say,
    client,
    source,
  }: {
    text: string;
    slackUserId: string;
    channelId: string;
    threadTs: string | undefined;
    messageTs: string | undefined;
    say: SayFn;
    client: WebClient;
    source: 'app_mention' | 'dm';
  }): Promise<void> {
    if (text.length === 0) {
      await say({
        thread_ts: threadTs,
        text: '메시지가 비어 있습니다. 어떤 작업이 필요한지 자연어로 적어주세요.',
      });
      return;
    }

    // 1단계: :eyes: — 봇이 메시지를 인지했음. (실패해도 dispatch 계속 — graceful.)
    await this.addReaction({
      client,
      channelId,
      messageTs,
      name: REACTION_ACK,
    });

    // 2단계: :hourglass: — LLM 처리 중. dispatch 종료 시 finally 에서 제거.
    let processingReactionAdded = false;
    if (messageTs) {
      processingReactionAdded = await this.addReaction({
        client,
        channelId,
        messageTs,
        name: REACTION_PROCESSING,
      });
    }

    const memoryKey = this.conversationMemory.buildKey({
      slackUserId,
      channelId,
    });
    const priorTurns = await this.conversationMemory.getRecentTurns(memoryKey);
    // 직전 turn 의 worker run id — 있으면 dispatch 의 contextRefs.agentRunId 로 전달.
    // 가장 최근 (마지막) turn 부터 backward 탐색 — 분류 실패 (agentRunId=null) turn 은 skip.
    const priorAgentRunId = [...priorTurns]
      .reverse()
      .find((turn) => turn.agentRunId !== null)?.agentRunId;

    let succeeded = false;
    try {
      const result = await this.idaeriRouter.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId,
        text,
        priorTurns,
        ...(priorAgentRunId !== undefined && priorAgentRunId !== null
          ? { contextRefs: { agentRunId: priorAgentRunId } }
          : {}),
      });
      await this.conversationMemory.appendTurn(memoryKey, {
        text,
        agentType: result.workerType,
        agentRunId: result.agentRunId,
        timestampMs: Date.now(),
      });
      await say({
        thread_ts: threadTs,
        text: buildRouterReply(result),
      });
      succeeded = true;
    } catch (error: unknown) {
      // INTENT_CLASSIFY_FAILED — 사용자 의도가 worker 분류 어느 것에도 매핑되지 않은 경우.
      // 단순 인사 / 안부 / 잡담일 가능성 높음 → ConversationalReply 로 자연어 한 마디 답변.
      // 다른 RouterException (DEPTH_EXCEEDED, CYCLE_DETECTED 등) + 외부 시스템 에러는 기존 에러 분기.
      if (isIntentClassifyFailed(error)) {
        this.logger.log(
          `Router intent UNKNOWN — conversational fallback 으로 응답 (user=${slackUserId} text="${text.slice(0, 60)}")`,
        );
        try {
          const reply = await this.conversationalReply.reply({
            text,
            priorTurns,
          });
          await this.conversationMemory.appendTurn(memoryKey, {
            text,
            agentType: null,
            agentRunId: null,
            timestampMs: Date.now(),
          });
          await say({ thread_ts: threadTs, text: reply });
          succeeded = true;
        } catch (replyError: unknown) {
          this.logger.warn(
            `Conversational fallback 도 실패 — user=${slackUserId}: ${replyError instanceof Error ? replyError.message : String(replyError)}`,
          );
          await this.conversationMemory.appendTurn(memoryKey, {
            text,
            agentType: null,
            agentRunId: null,
            timestampMs: Date.now(),
          });
          await say({
            thread_ts: threadTs,
            text: `이대리 응답 실패: ${toUserFacingErrorMessage(replyError)}`,
          });
        }
      } else {
        this.logger.warn(
          `Router dispatch 실패 (${source}) — user=${slackUserId} text="${text.slice(0, 60)}": ${error instanceof Error ? error.message : String(error)}`,
        );
        // 실패 turn 도 memory 에 남김 — 다음 turn 의 사용자가 "방금 그건 실패" 회복 흐름 인식 가능.
        await this.conversationMemory.appendTurn(memoryKey, {
          text,
          agentType: null,
          agentRunId: null,
          timestampMs: Date.now(),
        });
        await say({
          thread_ts: threadTs,
          text: `이대리 처리 실패: ${toUserFacingErrorMessage(error)}`,
        });
      }
    } finally {
      // 성공/실패 무관 처리중 표시 제거. add 가 실패한 경우 (이미 누군가 같은 reaction 부착 등) 는
      // remove 시도 자체를 skip — 불필요한 Slack API 호출 회피.
      if (processingReactionAdded && messageTs) {
        await this.removeReaction({
          client,
          channelId,
          messageTs,
          name: REACTION_PROCESSING,
        });
      }
      // 성공 시 ✅ 부착 — 사용자가 "이거 처리됐다" 를 한눈에 확인.
      if (succeeded) {
        await this.addReaction({
          client,
          channelId,
          messageTs,
          name: REACTION_SUCCESS,
        });
      }
    }
  }

  // Slack reactions.add 실패는 graceful — 메시지 너무 오래됨 / scope 부족 / 이미 부착 등
  // 다양한 사유로 실패 가능. 본 진행 흐름을 막지 않는다. 성공 시 true, 실패 시 false.
  private async addReaction({
    client,
    channelId,
    messageTs,
    name,
  }: {
    client: WebClient;
    channelId: string;
    messageTs: string | undefined;
    name: string;
  }): Promise<boolean> {
    if (!messageTs) {
      return false;
    }
    try {
      await client.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name,
      });
      return true;
    } catch (error: unknown) {
      this.logger.debug(
        `Slack reactions.add(${name}) 실패 (channel=${channelId} ts=${messageTs}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async removeReaction({
    client,
    channelId,
    messageTs,
    name,
  }: {
    client: WebClient;
    channelId: string;
    messageTs: string;
    name: string;
  }): Promise<void> {
    try {
      await client.reactions.remove({
        channel: channelId,
        timestamp: messageTs,
        name,
      });
    } catch (error: unknown) {
      this.logger.debug(
        `Slack reactions.remove(${name}) 실패 (channel=${channelId} ts=${messageTs}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// intent classifier 가 어느 worker 에도 매핑 못 한 경우 (자연어 fallback 분기 트리거).
const isIntentClassifyFailed = (error: unknown): boolean =>
  error instanceof RouterException &&
  error.routerErrorCode === RouterErrorCode.INTENT_CLASSIFY_FAILED;

// Slack 멘션 prefix `<@U....>` 를 모두 제거 + 앞뒤 공백 trim.
// (사용자가 "<@BOT> 안녕" 형태로 보낸 경우 "안녕" 만 추출.)
const stripMentionPrefix = (text: string): string =>
  text.replace(/<@[A-Z0-9]+>\s*/g, '').trim();

// Router 결과 → Slack 답글 텍스트.
// - chain 없으면: root.formattedText + footer (worker · agentRunId).
// - chain 있으면: root.formattedText + child.formattedText 들을 '---' 구분으로 결합 +
//   footer 에 worker 시퀀스 (PM → BE → BE_TEST 형태) + 모든 agentRunId.
const buildRouterReply = (result: DispatchResult): string => {
  const handoffs = result.handoffResults ?? [];
  if (handoffs.length === 0) {
    return `${result.formattedText}\n\n_이대리 (${result.workerType}) · agentRunId=${result.agentRunId}_`;
  }
  const bodies = [
    result.formattedText,
    ...handoffs.map((h) => h.formattedText),
  ];
  const workerSequence = [
    result.workerType,
    ...handoffs.map((h) => h.workerType),
  ].join(' → ');
  const agentRunIds = [
    result.agentRunId,
    ...handoffs.map((h) => h.agentRunId),
  ].join(', ');
  return [
    bodies.join('\n\n---\n\n'),
    `_이대리 chain — ${workerSequence} · agentRunIds=[${agentRunIds}]_`,
  ].join('\n\n');
};
