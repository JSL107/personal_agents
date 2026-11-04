export type WorkTurn = 'MY_TURN' | 'WAITING_OTHERS' | 'UNKNOWN';
export type DailyTodoListStatus = 'LISTED' | 'EMPTY' | 'LOAD_FAILED';
export interface DailyTodoEntryInput {
  scheduleItemId: number;
  turn: WorkTurn;
  observed: boolean;
  position: number;
}
export interface DailyTodoListRecord {
  status: DailyTodoListStatus;
  entries: DailyTodoEntryInput[];
}
export interface FindDailyTodoInput {
  slackUserId: string;
  kstDate: string;
}
export interface ReplaceDailyTodoInput
  extends FindDailyTodoInput, DailyTodoListRecord {}
