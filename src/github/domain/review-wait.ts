import { countKstDaysBetween } from '../../common/util/kst-date.util';
import { PullRequestRef } from './port/github-client.port';

export interface ReviewWait {
  ref: PullRequestRef;
  waits: { reviewer: string; requestedAt: string }[];
  complete: boolean;
}

export interface ReviewWaitInput {
  ref: PullRequestRef;
  pendingReviewers: string[];
}

interface DescribeReviewWaitInput {
  wait: ReviewWait;
  now: Date;
}

export interface ReviewWaitDescription {
  label: string;
  days: number | null;
}

export const describeReviewWait = ({
  wait,
  now,
}: DescribeReviewWaitInput): ReviewWaitDescription => {
  if (!wait.complete || wait.waits.length === 0) {
    return { label: '리뷰 대기', days: null };
  }

  const earliestRequest = Math.min(
    ...wait.waits.map((entry) => new Date(entry.requestedAt).getTime()),
  );
  if (!Number.isFinite(earliestRequest)) {
    return { label: '리뷰 대기', days: null };
  }

  const days = countKstDaysBetween(new Date(earliestRequest), now) + 1;
  if (days < 2) {
    return { label: '리뷰 대기', days: null };
  }

  return { label: `리뷰 요청 후 ${days}일째 답 없음`, days };
};
