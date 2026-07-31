import {
  ReviewThread,
  ReviewThreadReaction,
} from '../../github/domain/port/github-client.port';

export type HarvestSignal =
  | { kind: 'ACKED'; source: 'REACTION'; replyBody: string | null }
  | { kind: 'REJECTED'; source: 'REACTION'; replyBody: string | null }
  | { kind: 'NEEDS_JUDGE'; replyBody: string }
  | { kind: 'STALE' }
  | { kind: 'NONE' };

export interface ResolveHarvestSignalInput {
  card: { githubCommentId: string | null };
  thread: ReviewThread | null;
  ownerLogin: string;
  pullRequestState: 'OPEN' | 'CLOSED' | 'MERGED';
}

export const resolveHarvestSignal = ({
  card,
  thread,
  ownerLogin,
  pullRequestState,
}: ResolveHarvestSignalInput): HarvestSignal => {
  const botCommentId = Number(card.githubCommentId);
  const botComment = thread?.comments.find(
    (comment) => comment.databaseId === botCommentId,
  );

  if (botComment) {
    const replyBodies =
      thread?.comments
        .filter(
          (comment) =>
            comment.authorLogin === ownerLogin &&
            comment.createdAt > botComment.createdAt,
        )
        .map((comment) => comment.body) ?? [];
    const replyBody = replyBodies.length > 0 ? replyBodies.join('\n') : null;

    let latestReaction: ReviewThreadReaction | null = null;
    for (const reaction of botComment.reactions) {
      const isOwnerDecision =
        reaction.userLogin === ownerLogin &&
        (reaction.content === 'THUMBS_UP' ||
          reaction.content === 'THUMBS_DOWN');
      if (!isOwnerDecision) {
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
