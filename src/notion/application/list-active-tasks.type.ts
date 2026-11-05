import { ListActiveTasksOptions } from '../domain/port/notion-client.port';

export interface ListActiveTasksInput extends ListActiveTasksOptions {
  // 업무 수집기 전용 — 오래 손대지 않은 진행 중 업무도 내 할 일이라 기간 컷을 끈다.
  skipStaleCutoff?: boolean;
}
