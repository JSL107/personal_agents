import {
  AuthorPullRequestSignals,
  AuthorTurnResult,
} from './author-pr-signals.type';

interface AuthorTurnRule {
  matches: (signals: AuthorPullRequestSignals) => boolean;
  result: AuthorTurnResult;
}

const UNKNOWN_RESULT: AuthorTurnResult = { turn: 'UNKNOWN', reason: null };

// 첫 번째로 일치하는 규칙이 판정 결과다.
const AUTHOR_TURN_RULES: AuthorTurnRule[] = [
  {
    matches: (signals) => !signals.observed,
    result: UNKNOWN_RESULT,
  },
  {
    matches: (signals) => signals.draft,
    result: { turn: 'MY_TURN', reason: '드래프트' },
  },
  {
    matches: (signals) =>
      signals.changesRequestedBy.some(
        (reviewer) => !signals.pendingReviewers.includes(reviewer),
      ),
    result: { turn: 'MY_TURN', reason: '수정 요청 받음' },
  },
  {
    matches: (signals) => signals.mergeableState === 'dirty',
    result: { turn: 'MY_TURN', reason: '충돌 있음' },
  },
  {
    matches: (signals) =>
      signals.isApproved && signals.mergeableState === 'clean',
    result: { turn: 'MY_TURN', reason: '승인됨' },
  },
  {
    matches: (signals) =>
      signals.isApproved && signals.mergeableState === 'behind',
    result: { turn: 'MY_TURN', reason: '브랜치 갱신 필요' },
  },
  {
    matches: (signals) => signals.pendingReviewers.length > 0,
    result: { turn: 'WAITING_OTHERS', reason: '리뷰 대기' },
  },
  {
    matches: (signals) => signals.mergeableState === 'unstable',
    result: { turn: 'MY_TURN', reason: 'CI 실패' },
  },
];

export const classifyAuthorPullRequestTurn = (
  signals: AuthorPullRequestSignals,
): AuthorTurnResult =>
  AUTHOR_TURN_RULES.find((rule) => rule.matches(signals))?.result ??
  UNKNOWN_RESULT;
