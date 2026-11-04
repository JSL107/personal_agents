import { GithubPullRequestSummary } from '../../github/domain/github.type';
import { ScheduleItemRecord } from './schedule.type';

export interface MatchPullRequestInput {
  pullRequest: GithubPullRequestSummary;
  items: ScheduleItemRecord[];
}

export type MatchPullRequestResult =
  | { kind: 'ONE'; item: ScheduleItemRecord }
  | { kind: 'NONE' | 'AMBIGUOUS' };
