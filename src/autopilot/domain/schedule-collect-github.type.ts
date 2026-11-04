import {
  GithubIssue,
  GithubPullRequestSummary,
} from '../../github/domain/github.type';
import { GithubItemLifecycle } from '../../github/domain/port/github-client.port';
import {
  ScheduleEventKind,
  ScheduleItemRecord,
  ScheduleStatus,
} from '../../schedule/domain/schedule.type';

export interface LifecycleObservation {
  item: ScheduleItemRecord;
  lifecycle: GithubItemLifecycle;
}

export interface CollectIssueInput {
  issue: GithubIssue;
  ownerId: string;
  now: Date;
}

export interface CollectPullRequestInput {
  pullRequest: GithubPullRequestSummary;
  ownerId: string;
  now: Date;
  candidates: ScheduleItemRecord[];
}

export interface RecordPrEventInput {
  item: ScheduleItemRecord;
  pullRequest: GithubPullRequestSummary;
  kind: ScheduleEventKind.PR_LINKED | ScheduleEventKind.PR_MERGED;
  ownerId: string;
  now: Date;
}

export interface ApplyLifecycleInput extends LifecycleObservation {
  ownerId: string;
  now: Date;
}

export interface OwnedScheduleInput {
  item: ScheduleItemRecord;
  ownerId: string;
}

export interface SourceEditInput {
  item: ScheduleItemRecord;
  title: string;
  now: Date;
}

export interface TransitionCollectedInput extends OwnedScheduleInput {
  to: ScheduleStatus;
  now: Date;
}
