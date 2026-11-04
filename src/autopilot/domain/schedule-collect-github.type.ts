import { GithubIssue } from '../../github/domain/github.type';
import { ScheduleItemRecord } from '../../schedule/domain/schedule.type';

export interface CollectIssueInput {
  issue: GithubIssue;
  ownerId: string;
  now: Date;
}

export interface SourceEditInput {
  item: ScheduleItemRecord;
  title: string;
  now: Date;
}
