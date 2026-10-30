import { wrapUntrustedInput } from '../../common/llm/untrusted-input.util';
import { AgentType } from '../../model-router/domain/model-router.type';
import { AUTO_POST_LABEL } from '../../router/domain/auto-post-turn';
import { ConversationTurn } from '../../router/domain/conversation-memory.type';
import {
  AUTO_POST_TEXT_CAP,
  PRIOR_TURN_TEXT_CAP,
} from '../../router/domain/conversation-prompt-limits';
import { stripMentionPrefix } from './slack-mention';

// 이대리가 대화 답에 붙이는 Slack 메시지 metadata 의 event_type. 같은 봇 토큰으로 올라오는
// 아침신문(Hermes)·autopilot 알림과 대화 답을 가르는 유일한 표식이다(2026-10-30 Task 0 실측).
export const IDAERI_REPLY_EVENT_TYPE = 'idaeri_reply';

export interface SlackTranscriptFile {
  id: string;
  mimetype: string;
  size: number;
  urlPrivateDownload: string;
}

export interface SlackTranscriptMetadata {
  eventType: string;
  eventPayload: Record<string, unknown>;
}

export interface SlackTranscriptMessage {
  ts: string;
  user?: string;
  botId?: string;
  text: string;
  metadata?: SlackTranscriptMetadata;
  replyCount?: number;
  threadTs?: string;
  files: SlackTranscriptFile[];
}

export interface ToTranscriptTurnsInput {
  messages: readonly SlackTranscriptMessage[];
  speakerUserId: string;
  // 이 봇이 쓴 글의 꼬리표만 대화 답으로 인정한다 — 채널 스레드의 다른 봇이 같은 꼬리표를 달 수 있다.
  // 모르면(auth.test 실패) 꼬리표가 있어도 자동 발송 글로 다룬다.
  selfBotId?: string;
  excludeTs?: string;
  imageLabels?: ReadonlyMap<string, readonly number[]>;
  // Redis 대화 기억. 발화자 글은 자르기 전 원문이 같은 기억 턴에서 agentType·agentRunId 를 받는다 —
  // 일정 되묻기 이어 붙이기·PR 참조·공고 명령 승계가 user 턴의 agentType 을 본다.
  memoryTurns?: readonly ConversationTurn[];
}

type TurnSource = 'SPEAKER' | 'IDAERI_REPLY' | 'AUTO_POST';

interface SourcedMessage {
  message: SlackTranscriptMessage;
  source: TurnSource;
  originalText: string;
}

// Slack 기록을 대화 턴으로 바꾼다. 발화자 글은 user, 이대리 대화 답은 assistant, 나머지(자동 발송 글·
// 다른 사람 글)는 경계로 감싼 user 턴이다. assistant 로 두면 분류기·대화 답변이 그 글을 자기 발화로 읽는다.
export const toTranscriptTurns = ({
  messages,
  speakerUserId,
  selfBotId,
  excludeTs,
  imageLabels,
  memoryTurns = [],
}: ToTranscriptTurnsInput): ConversationTurn[] => {
  const sourced = dedupeAndSort(messages, excludeTs).map((message) =>
    classify(message, speakerUserId, selfBotId),
  );
  const memoryMatches = matchSpeakerTurnsToMemory(sourced, memoryTurns);
  return sourced.map((item, index) => {
    const labels = imageLabels
      ?.get(item.message.ts)
      ?.map((imageIndex) => `[사진 ${imageIndex}번 첨부]`)
      .join(' ');
    const text = renderText(item);
    const matched = memoryMatches.get(index);
    const replyMeta =
      item.source === 'IDAERI_REPLY'
        ? readReplyPayload(item.message.metadata?.eventPayload)
        : undefined;
    return {
      role: item.source === 'IDAERI_REPLY' ? 'assistant' : 'user',
      text: labels ? `${text}\n${labels}` : text,
      agentType: replyMeta?.agentType ?? matched?.agentType ?? null,
      agentRunId: replyMeta?.agentRunId ?? matched?.agentRunId ?? null,
      timestampMs: Math.floor(Number(item.message.ts) * 1000),
    };
  });
};

const dedupeAndSort = (
  messages: readonly SlackTranscriptMessage[],
  excludeTs: string | undefined,
): SlackTranscriptMessage[] => {
  const seen = new Set<string>();
  return [...messages]
    .sort((left, right) => Number(left.ts) - Number(right.ts))
    .filter((message) => {
      if (message.ts === excludeTs || seen.has(message.ts)) {
        return false;
      }
      seen.add(message.ts);
      return true;
    });
};

const classify = (
  message: SlackTranscriptMessage,
  speakerUserId: string,
  selfBotId: string | undefined,
): SourcedMessage => {
  if (!message.botId && message.user === speakerUserId) {
    return {
      message,
      source: 'SPEAKER',
      originalText: stripMentionPrefix(message.text),
    };
  }
  const isIdaeriReply =
    message.botId !== undefined &&
    message.metadata?.eventType === IDAERI_REPLY_EVENT_TYPE &&
    selfBotId !== undefined &&
    message.botId === selfBotId;
  return {
    message,
    source: isIdaeriReply ? 'IDAERI_REPLY' : 'AUTO_POST',
    originalText: message.text.trim(),
  };
};

// 자르기는 경계로 감싸기 전에 한다 — 감싼 뒤 자르면 닫는 표식이 잘려 경계가 열린 채 끝난다.
const renderText = ({ source, originalText }: SourcedMessage): string => {
  if (source === 'AUTO_POST') {
    return `${AUTO_POST_LABEL}\n${wrapUntrustedInput(originalText.slice(0, AUTO_POST_TEXT_CAP))}`;
  }
  return originalText.slice(0, PRIOR_TURN_TEXT_CAP);
};

interface ReplyPayload {
  agentType: AgentType | null;
  agentRunId: number | null;
}

const readReplyPayload = (
  payload: Record<string, unknown> | undefined,
): ReplyPayload => {
  const agentType = payload?.agentType;
  const agentRunId = payload?.agentRunId;
  return {
    agentType: isAgentType(agentType) ? agentType : null,
    // 원장 id 는 양의 정수다 — 작업 상태 조회(conversational-reply)도 `> 0` 만 실행으로 본다.
    agentRunId:
      typeof agentRunId === 'number' &&
      Number.isInteger(agentRunId) &&
      agentRunId > 0
        ? agentRunId
        : null,
  };
};

const isAgentType = (value: unknown): value is AgentType =>
  typeof value === 'string' &&
  (Object.values(AgentType) as string[]).includes(value);

// 발화자 턴을 최신부터 거꾸로 훑어, 아직 안 쓴 같은 원문의 기억 턴과 1:1 로 짝짓는다.
// 같은 문구를 두 번 보냈을 때 한 기억 턴이 두 Slack 턴에 붙지 않게 하려는 것이다.
const matchSpeakerTurnsToMemory = (
  sourced: readonly SourcedMessage[],
  memoryTurns: readonly ConversationTurn[],
): Map<number, ConversationTurn> => {
  const matches = new Map<number, ConversationTurn>();
  const usedMemoryIndexes = new Set<number>();
  for (let index = sourced.length - 1; index >= 0; index -= 1) {
    const item = sourced[index];
    if (item.source !== 'SPEAKER') {
      continue;
    }
    for (
      let memoryIndex = memoryTurns.length - 1;
      memoryIndex >= 0;
      memoryIndex -= 1
    ) {
      const memory = memoryTurns[memoryIndex];
      if (
        !usedMemoryIndexes.has(memoryIndex) &&
        memory.role !== 'assistant' &&
        memory.text.trim() === item.originalText
      ) {
        usedMemoryIndexes.add(memoryIndex);
        matches.set(index, memory);
        break;
      }
    }
  }
  return matches;
};

// 이대리 대화 답에 붙이는 Slack metadata. Slack API 필드명(snake_case)을 그대로 쓴다.
// event_payload 값 타입은 Slack SDK MessageMetadata 와 맞춘다 — 넓히면 say/chat.postMessage 에 형변환이 필요해진다.
export interface IdaeriReplyMetadata {
  event_type: string;
  event_payload: Record<string, string | number>;
}

export const buildIdaeriReplyMetadata = ({
  agentType,
  agentRunId,
}: ReplyPayload): IdaeriReplyMetadata => ({
  event_type: IDAERI_REPLY_EVENT_TYPE,
  event_payload: {
    ...(agentType === null ? {} : { agentType }),
    ...(agentRunId === null ? {} : { agentRunId }),
  },
});
