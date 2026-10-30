import { wrapUntrustedInput } from '../../common/llm/untrusted-input.util';
import { AgentType } from '../../model-router/domain/model-router.type';
import { AUTO_POST_LABEL } from '../../router/domain/auto-post-turn';
import {
  ConversationTurn,
  ConversationTurnRole,
} from '../../router/domain/conversation-memory.type';
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
  const ordered = dedupeAndSort({ messages, excludeTs });
  const sourced = ordered.map((message) =>
    classify({ message, speakerUserId, selfBotId }),
  );
  const memoryMatches = matchSpeakerTurnsToMemory({ sourced, memoryTurns });
  const turns = sourced.map((item, index) =>
    buildTurn({ item, matched: memoryMatches.get(index), imageLabels }),
  );
  return turns;
};

interface BuildTurnInput {
  item: SourcedMessage;
  matched: ConversationTurn | undefined;
  imageLabels: ReadonlyMap<string, readonly number[]> | undefined;
}

const buildTurn = ({
  item,
  matched,
  imageLabels,
}: BuildTurnInput): ConversationTurn => {
  const isIdaeriReply = item.source === 'IDAERI_REPLY';
  // 이대리 답은 꼬리표의 실행 정보를, 발화자 글은 Redis 매칭 결과를 쓴다.
  const replyPayload = isIdaeriReply
    ? readReplyPayload(item.message.metadata?.eventPayload)
    : undefined;
  const role: ConversationTurnRole = isIdaeriReply ? 'assistant' : 'user';
  const text = appendImageLabels({
    text: renderText(item),
    labels: imageLabels?.get(item.message.ts),
  });
  const agentType = replyPayload?.agentType ?? matched?.agentType ?? null;
  const agentRunId = replyPayload?.agentRunId ?? matched?.agentRunId ?? null;
  const timestampMs = Math.floor(Number(item.message.ts) * 1000);
  return { role, text, agentType, agentRunId, timestampMs };
};

const appendImageLabels = ({
  text,
  labels,
}: {
  text: string;
  labels: readonly number[] | undefined;
}): string => {
  if (!labels || labels.length === 0) {
    return text;
  }
  const labelText = labels
    .map((imageIndex) => `[사진 ${imageIndex}번 첨부]`)
    .join(' ');
  return `${text}\n${labelText}`;
};

const dedupeAndSort = ({
  messages,
  excludeTs,
}: {
  messages: readonly SlackTranscriptMessage[];
  excludeTs: string | undefined;
}): SlackTranscriptMessage[] => {
  const sorted = [...messages].sort(
    (left, right) => Number(left.ts) - Number(right.ts),
  );
  const seen = new Set<string>();
  const unique = sorted.filter((message) => {
    if (message.ts === excludeTs || seen.has(message.ts)) {
      return false;
    }
    seen.add(message.ts);
    return true;
  });
  return unique;
};

const classify = ({
  message,
  speakerUserId,
  selfBotId,
}: {
  message: SlackTranscriptMessage;
  speakerUserId: string;
  selfBotId: string | undefined;
}): SourcedMessage => {
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
  const source: TurnSource = isIdaeriReply ? 'IDAERI_REPLY' : 'AUTO_POST';
  const originalText = message.text.trim();
  return { message, source, originalText };
};

// 자르기는 경계로 감싸기 전에 한다 — 감싼 뒤 자르면 닫는 표식이 잘려 경계가 열린 채 끝난다.
const renderText = ({ source, originalText }: SourcedMessage): string => {
  if (source !== 'AUTO_POST') {
    return originalText.slice(0, PRIOR_TURN_TEXT_CAP);
  }
  const wrapped = wrapUntrustedInput(originalText.slice(0, AUTO_POST_TEXT_CAP));
  return `${AUTO_POST_LABEL}\n${wrapped}`;
};

interface ReplyPayload {
  agentType: AgentType | null;
  agentRunId: number | null;
}

const readReplyPayload = (
  payload: Record<string, unknown> | undefined,
): ReplyPayload => {
  const agentType = isAgentType(payload?.agentType) ? payload.agentType : null;
  const agentRunId = readAgentRunId(payload?.agentRunId);
  return { agentType, agentRunId };
};

// 원장 id 는 양의 정수다 — 작업 상태 조회(conversational-reply)도 `> 0` 만 실행으로 본다.
const readAgentRunId = (value: unknown): number | null => {
  const isPositiveInteger =
    typeof value === 'number' && Number.isInteger(value) && value > 0;
  if (!isPositiveInteger) {
    return null;
  }
  return value;
};

const isAgentType = (value: unknown): value is AgentType =>
  typeof value === 'string' &&
  (Object.values(AgentType) as string[]).includes(value);

// 발화자 턴을 최신부터 거꾸로 훑어, 아직 안 쓴 같은 원문의 기억 턴과 1:1 로 짝짓는다.
// 같은 문구를 두 번 보냈을 때 한 기억 턴이 두 Slack 턴에 붙지 않게 하려는 것이다.
const matchSpeakerTurnsToMemory = ({
  sourced,
  memoryTurns,
}: {
  sourced: readonly SourcedMessage[];
  memoryTurns: readonly ConversationTurn[];
}): Map<number, ConversationTurn> => {
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
      const isSameUserText =
        memory.role !== 'assistant' && memory.text.trim() === item.originalText;
      if (!usedMemoryIndexes.has(memoryIndex) && isSameUserText) {
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
}: ReplyPayload): IdaeriReplyMetadata => {
  // null 은 싣지 않는다 — 읽는 쪽(readReplyPayload)이 없는 값을 null 로 되돌린다.
  const eventPayload: Record<string, string | number> = {};
  if (agentType !== null) {
    eventPayload.agentType = agentType;
  }
  if (agentRunId !== null) {
    eventPayload.agentRunId = agentRunId;
  }
  return { event_type: IDAERI_REPLY_EVENT_TYPE, event_payload: eventPayload };
};
