import {
  ReviewThread,
  ReviewThreadReaction,
} from '../../github/domain/port/github-client.port';
import { IDAERI_REVIEW_MARKER } from './finding-comment.body';

export type HarvestSignal =
  | { kind: 'ACKED'; source: 'REACTION'; replyBody: string | null }
  | { kind: 'REJECTED'; source: 'REACTION'; replyBody: string | null }
  | { kind: 'NEEDS_JUDGE'; replyBody: string }
  | { kind: 'STALE' }
  | { kind: 'NONE' };

export interface ResolveHarvestSignalInput {
  card: { githubCommentId: string | null };
  thread: ReviewThread | null;
  decisionLogins: string[];
  pullRequestState: 'OPEN' | 'CLOSED' | 'MERGED';
  truncated: boolean;
}

export const resolveHarvestSignal = ({
  card,
  thread,
  decisionLogins,
  pullRequestState,
  truncated,
}: ResolveHarvestSignalInput): HarvestSignal => {
  const botCommentId = Number(card.githubCommentId);
  const botComment = thread?.comments.find(
    (comment) => comment.databaseId === botCommentId,
  );

  if (botComment) {
    // 이대리는 owner 토큰으로 코멘트를 달기 때문에 봇 코멘트의 authorLogin 도 owner 일 수 있다.
    // 표식으로 걸러내지 않으면 같은 스레드의 봇 후속 코멘트를 사람 답글로 읽어
    // LLM 에게 자기 글을 판정시킨다 (Phase 2b 에서 봇이 답글로 응수하면 즉시 발생).
    const replyBodies =
      thread?.comments
        .filter(
          (comment) =>
            comment.authorLogin !== null &&
            decisionLogins.includes(comment.authorLogin) &&
            !comment.body.startsWith(IDAERI_REVIEW_MARKER) &&
            comment.createdAt > botComment.createdAt,
        )
        .map((comment) => comment.body) ?? [];
    const replyBody = replyBodies.length > 0 ? replyBodies.join('\n') : null;

    let latestReaction: ReviewThreadReaction | null = null;
    for (const reaction of botComment.reactions) {
      const isDecisionReaction =
        reaction.userLogin !== null &&
        decisionLogins.includes(reaction.userLogin) &&
        (reaction.content === 'THUMBS_UP' ||
          reaction.content === 'THUMBS_DOWN');
      if (!isDecisionReaction) {
        continue;
      }
      if (
        latestReaction === null ||
        reaction.createdAt > latestReaction.createdAt
      ) {
        latestReaction = reaction;
      }
    }

    if (latestReaction?.content === 'THUMBS_UP') {
      return { kind: 'ACKED', source: 'REACTION', replyBody };
    }
    if (latestReaction?.content === 'THUMBS_DOWN') {
      return { kind: 'REJECTED', source: 'REACTION', replyBody };
    }

    if (replyBody !== null) {
      return { kind: 'NEEDS_JUDGE', replyBody };
    }
  }

  if (truncated && !botComment) {
    return { kind: 'NONE' };
  }
  if (pullRequestState !== 'OPEN') {
    return { kind: 'STALE' };
  }
  return { kind: 'NONE' };
};

export const findThreadForComment = (
  threads: ReviewThread[],
  githubCommentId: string,
): ReviewThread | null => {
  const commentId = Number(githubCommentId);
  if (!Number.isSafeInteger(commentId)) {
    return null;
  }
  const found = threads.find((thread) =>
    thread.comments.some((comment) => comment.databaseId === commentId),
  );
  return found ?? null;
};
