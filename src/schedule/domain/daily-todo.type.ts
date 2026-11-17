export type WorkTurn = 'MY_TURN' | 'WAITING_OTHERS' | 'UNKNOWN';
// 아침 목록에 실린 자리. 오래 움직임 없는 PR 은 「멈춘 일」로 따로 실리고 저녁 완료율에서 빠진다.
export const STALLED_TURN = 'STALLED' as const;
export type DailyTodoTurn = WorkTurn | typeof STALLED_TURN;
export type DailyTodoListStatus = 'LISTED' | 'EMPTY' | 'LOAD_FAILED';
export interface DailyTodoEntryInput {
  scheduleItemId: number;
  turn: DailyTodoTurn;
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
