import { Logger } from '@nestjs/common';
import { App, SayFn } from '@slack/bolt';

import { ConversationMemoryService } from '../../router/application/conversation-memory.service';
import {
  DispatchResult,
  IdaeriRouterPort,
} from '../../router/domain/idaeri-router.port';
import { toUserFacingErrorMessage } from './slack-handler.helper';

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
export const registerRouterMessageHandler = (
  app: App,
  deps: {
    idaeriRouter: IdaeriRouterPort;
    conversationMemory: ConversationMemoryService;
    logger: Logger;
  },
): void => {
  app.event('app_mention', async ({ event, say }) => {
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

    await processRouterMessage({
      text: stripMentionPrefix(rawText),
      slackUserId,
      channelId,
      threadTs,
      say,
      deps,
      source: 'app_mention',
    });
  });

  // DM (channel_type='im') 진입. subtype 없는 user message 만 — bot 자신의 메시지 / edit /
  // delete event 등은 필터 (무한 루프 방지). 멘션 prefix 처리 X (DM 은 1:1 이라 멘션 없음).
  app.event('message', async ({ event, say }) => {
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
    const threadTs =
      'thread_ts' in event && typeof event.thread_ts === 'string'
        ? event.thread_ts
        : 'ts' in event && typeof event.ts === 'string'
          ? event.ts
          : undefined;

    await processRouterMessage({
      text: rawText.trim(),
      slackUserId,
      channelId,
      threadTs,
      say,
      deps,
      source: 'dm',
    });
  });
};

const processRouterMessage = async ({
  text,
  slackUserId,
  channelId,
  threadTs,
  say,
  deps,
  source,
}: {
  text: string;
  slackUserId: string;
  channelId: string;
  threadTs: string | undefined;
  say: SayFn;
  deps: {
    idaeriRouter: IdaeriRouterPort;
    conversationMemory: ConversationMemoryService;
    logger: Logger;
  };
  source: 'app_mention' | 'dm';
}): Promise<void> => {
  if (text.length === 0) {
    await say({
      thread_ts: threadTs,
      text: '메시지가 비어 있습니다. 어떤 작업이 필요한지 자연어로 적어주세요.',
    });
    return;
  }

  const memoryKey = deps.conversationMemory.buildKey({
    slackUserId,
    channelId,
  });
  const priorTurns = await deps.conversationMemory.getRecentTurns(memoryKey);
  // 직전 turn 의 worker run id — 있으면 dispatch 의 contextRefs.agentRunId 로 전달.
  // 가장 최근 (마지막) turn 부터 backward 탐색 — 분류 실패 (agentRunId=null) turn 은 skip.
  const priorAgentRunId = [...priorTurns]
    .reverse()
    .find((turn) => turn.agentRunId !== null)?.agentRunId;

  try {
    const result = await deps.idaeriRouter.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId,
      text,
      priorTurns,
      ...(priorAgentRunId !== undefined && priorAgentRunId !== null
        ? { contextRefs: { agentRunId: priorAgentRunId } }
        : {}),
    });
    await deps.conversationMemory.appendTurn(memoryKey, {
      text,
      agentType: result.workerType,
      agentRunId: result.agentRunId,
      timestampMs: Date.now(),
    });
    await say({
      thread_ts: threadTs,
      text: buildRouterReply(result),
    });
  } catch (error: unknown) {
    deps.logger.warn(
      `Router dispatch 실패 (${source}) — user=${slackUserId} text="${text.slice(0, 60)}": ${error instanceof Error ? error.message : String(error)}`,
    );
    // 실패 turn 도 memory 에 남김 — 다음 turn 의 사용자가 "방금 그건 실패" 회복 흐름 인식 가능.
    await deps.conversationMemory.appendTurn(memoryKey, {
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
};

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
