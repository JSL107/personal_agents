import {
  ScheduleDetail,
  ScheduleEventRecord,
} from '../domain/schedule.repository.type';

export interface ScheduleConsoleDetail extends ScheduleDetail {
  linkedPullRequests: ScheduleEventRecord[];
}
