import {
  AddEventInput,
  AddFollowUpInput,
  AddNoteInput,
  CollectedScheduleInput,
  DueClaimInput,
  FindScheduleDetailInput,
  MarkFollowUpNotifiedInput,
  MarkRemindedInput,
  PersistScheduleFieldsInput,
  ScheduleDetail,
  ScheduleEventRecord,
  ScheduleFollowUpRecord,
  TransitionInput,
  UpdateFollowUpInput,
} from '../schedule.repository.type';
import {
  DatedScheduleItemRecord,
  ScheduleItemRecord,
  ScheduleStatus,
} from '../schedule.type';

export interface SaveScheduleInput {
  slackUserId: string;
  title: string;
  dueDate: Date;
  dueTime?: string;
  startDate?: Date | null;
  remindAt?: Date | null;
  memo?: string;
  // 생략하면 false — 사람이 등록한 일정이 기본이고, 공휴일은 `SyncKoreanHolidaysUsecase`
  // 하나만 true 로 넣는다.
  isHoliday?: boolean;
}

export interface FindByDateRangeInput {
  slackUserId: string;
  // **생략하면 하한을 걸지 않는다** — 기한이 지난 미완 항목까지 전부 가져온다.
  // 아침 브리핑이 이쪽을 쓴다. 하한을 오늘로 두면 어제 놓친 마감이 조회에서 통째로
  // 빠지는데, 놓친 마감을 알리는 것이 이 기능의 목적이라 하한이 목적을 거스른다.
  // 특정 달만 보는 콘솔 격자는 반대로 하한이 필요해 그대로 넘긴다.
  from?: Date;
  to: Date;
}

export interface UpdateStatusInput {
  id: number;
  status: ScheduleStatus;
  completedAt: Date | null;
}

export interface ScheduleRepositoryPort {
  save(input: SaveScheduleInput): Promise<ScheduleItemRecord>;
  findByDateRange(
    input: FindByDateRangeInput,
  ): Promise<DatedScheduleItemRecord[]>;
  findTrackingMonth(
    input: Required<FindByDateRangeInput>,
  ): Promise<ScheduleItemRecord[]>;
  findUndated(slackUserId: string): Promise<ScheduleItemRecord[]>;
  findById(id: number): Promise<ScheduleItemRecord | null>;
  updateStatus(input: UpdateStatusInput): Promise<ScheduleItemRecord>;
  transition(input: TransitionInput): Promise<ScheduleItemRecord | null>;
  createCollected(
    input: CollectedScheduleInput,
  ): Promise<ScheduleItemRecord | 'DUPLICATE'>;
  updateFields(
    input: PersistScheduleFieldsInput,
  ): Promise<ScheduleItemRecord | null>;
  claimDueReminders(input: DueClaimInput): Promise<ScheduleItemRecord[]>;
  claimDueFollowUps(input: DueClaimInput): Promise<ScheduleFollowUpRecord[]>;
  markReminded(input: MarkRemindedInput): Promise<boolean>;
  markFollowUpNotified(input: MarkFollowUpNotifiedInput): Promise<boolean>;
  expireCandidates(now: Date): Promise<number>;
  addFollowUp(input: AddFollowUpInput): Promise<ScheduleFollowUpRecord | null>;
  updateFollowUp(
    input: UpdateFollowUpInput,
  ): Promise<ScheduleFollowUpRecord | null>;
  addNote(input: AddNoteInput): Promise<ScheduleEventRecord | null>;
  addEvent(input: AddEventInput): Promise<ScheduleEventRecord | 'DUPLICATE'>;
  findDetail(input: FindScheduleDetailInput): Promise<ScheduleDetail | null>;
  // 이미 있는 줄을 공휴일로 승격한다. 사용자가 손으로 넣어 둔 같은 날·같은 이름의 일정을
  // 그냥 건너뛰면 그 날은 빨갛게 서지도, 아침 브리핑에서 빠지지도 않아 **그 날만 기능이
  // 통째로 안 먹는다.** 새 줄을 만들지 않는 것은 달력에 같은 이름이 두 줄로 서기 때문이다.
  markAsHoliday(id: number): Promise<ScheduleItemRecord>;
  deleteById(id: number): Promise<void>;
}

export const SCHEDULE_REPOSITORY_PORT = Symbol('SCHEDULE_REPOSITORY_PORT');
