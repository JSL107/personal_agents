import { ScheduleItemRecord } from '../../schedule/domain/schedule.type';
export interface TrackingLinesInput {
  undatedInProgress: ScheduleItemRecord[];
  candidateCount: number;
}
