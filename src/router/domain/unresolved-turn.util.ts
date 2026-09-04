import { ConversationTurn } from './conversation-memory.type';

export const isUnresolvedFollowUpTurn = (turn: ConversationTurn): boolean =>
  turn.role === 'assistant' &&
  turn.agentType === null &&
  /[?？]$/.test(turn.text.trim());

export const calculateUnresolvedStreak = (
  turns: ConversationTurn[],
): number => {
  let streak = 0;
  for (const turn of [...turns].reverse()) {
    if (turn.role !== 'assistant') {
      continue;
    }
    if (!isUnresolvedFollowUpTurn(turn)) {
      break;
    }
    streak += 1;
  }
  return streak;
};
