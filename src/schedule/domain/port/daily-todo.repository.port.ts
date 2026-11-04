import {
  DailyTodoListRecord,
  FindDailyTodoInput,
  ReplaceDailyTodoInput,
} from '../daily-todo.type';
export const DAILY_TODO_REPOSITORY_PORT = Symbol('DAILY_TODO_REPOSITORY_PORT');
export interface DailyTodoRepositoryPort {
  replaceForDate(input: ReplaceDailyTodoInput): Promise<void>;
  findForDate(input: FindDailyTodoInput): Promise<DailyTodoListRecord | null>;
}
