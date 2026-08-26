import {
  ReviewThread,
  ReviewThreadReaction,
} from '../../github/domain/port/github-client.port';
import { IDAERI_REVIEW_MARKER } from './finding-comment.body';

export type HarvestSignal =
  | { kind: 'ACKED'; source: 'REACTION'; replyBody: string | null }
  | {
      kind: 'REJECTED';
      source: 'REACTION';
      replyBody: string | null;
      ownerReplyBody: string | null;
    }
  | { kind: 'NEEDS_JUDGE'; replyBody: string; ownerReplyBody: string | null }
  | { kind: 'STALE' }
  | { kind: 'NONE' };

export interface ResolveHarvestSignalInput {
  card: { githubCommentId: string | null };
  thread: ReviewThread | null;
  decisionLogins: string[];
  /**
   * 저장소 owner. 결정 주체(`decisionLogins`)보다 좁다.
   *
   * 기각 이유는 그대로 다음 리뷰의 레포 규약이 되므로(`renderLearnedConventions`), 그 문장을
   * 쓸 수 있는 사람은 owner 하나여야 한다. `decisionLogins` 에는 **PR 작성자**도 들어가는데,
   * 공개 저장소에서는 제3자가 PR 을 올려 자기 답글을 규약으로 굳힐 수 있다 — 같은 카테고리에
   * 두 번만 그러면 임계를 채운다(`MIN_REJECTIONS_PER_CATEGORY`).
   *
   * 판정 입력(`replyBody`)에는 여전히 대화 전체를 넣는다. 누가 무엇을 수용했는지는 스레드
   * 전체를 봐야 정확하고, 그 결과는 상태(ACKED/REJECTED)일 뿐 프롬프트로 흘러가지 않는다.
   */
  ownerLogin: string;
  pullRequestState: 'OPEN' | 'CLOSED' | 'MERGED';
  truncated: boolean;
}

export const resolveHarvestSignal = ({
  card,
  thread,
  decisionLogins,
  ownerLogin,
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
    const humanReplies =
      thread?.comments.filter(
        (comment) =>
          comment.authorLogin !== null &&
          decisionLogins.includes(comment.authorLogin) &&
          !comment.body.startsWith(IDAERI_REVIEW_MARKER) &&
          comment.createdAt > botComment.createdAt,
      ) ?? [];
    const joinBodies = (comments: typeof humanReplies): string | null =>
      comments.length > 0
        ? comments.map((comment) => comment.body).join('\n')
        : null;
    const replyBody = joinBodies(humanReplies);
    // 규약으로 굳을 문장은 owner 가 쓴 것만 남긴다 — 이유는 `ownerLogin` 주석 참조.
    const ownerReplyBody = joinBodies(
      humanReplies.filter((comment) => comment.authorLogin === ownerLogin),
    );

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
      return {
        kind: 'REJECTED',
        source: 'REACTION',
        replyBody,
        ownerReplyBody,
      };
    }

    if (replyBody !== null) {
      return { kind: 'NEEDS_JUDGE', replyBody, ownerReplyBody };
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
