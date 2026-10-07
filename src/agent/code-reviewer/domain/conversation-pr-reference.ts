import { AgentType } from '../../../model-router/domain/model-router.type';
import { ConversationTurn } from '../../../router/domain/conversation-memory.type';
import { findPrReferences, toShorthand } from './pr-reference.parser';

// 링크 없는 후속 지시("게시까지 진행해줘.", "리뷰를 게시하라고")가 직전 리뷰 대상을 잇게 한다.
// 2026-08-27 DM 에서 같은 요청이 PR 참조 형식 오류로 두 번 막혔다 — PR 참조를 그 턴 원문에서만 찾았다.
//
// 코드 리뷰 턴(agentType=CODE_REVIEWER)에서만 찾는다. 자연어 경로는 publish 기본값이 true 라,
// 다른 워커(이력서 회고 등)가 다룬 PR 을 잘못 집으면 엉뚱한 PR 에 코멘트가 달린다.
// 서로 다른 PR 이 둘 이상이면 고르지 않고 되묻는다 — 같은 이유로 추측하면 안 된다.
export type ConversationPrReference =
  | { kind: 'FROM_TEXT' }
  | { kind: 'INHERITED'; prRef: string }
  | { kind: 'AMBIGUOUS'; candidates: string[] }
  | { kind: 'NONE' };

export const resolvePrReferenceFromConversation = (
  text: string,
  priorTurns: readonly ConversationTurn[] | undefined,
): ConversationPrReference => {
  if (findPrReferences(text).length > 0) {
    return { kind: 'FROM_TEXT' };
  }
  const candidates = [
    ...new Set(
      (priorTurns ?? [])
        .filter((turn) => turn.agentType === AgentType.CODE_REVIEWER)
        .flatMap((turn) => findPrReferences(turn.text).map(toShorthand)),
    ),
  ];
  if (candidates.length === 1) {
    return { kind: 'INHERITED', prRef: candidates[0] };
  }
  if (candidates.length > 1) {
    return { kind: 'AMBIGUOUS', candidates };
  }
  return { kind: 'NONE' };
};
