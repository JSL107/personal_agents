export const AUTOPILOT_TASKS = Symbol('AUTOPILOT_TASKS');

export interface AutopilotTaskContext {
  ownerSlackUserId: string;
  firedAtKst: string; // 오케스트레이터가 getTodayKstDate() 로 1회 계산해 주입.
}

export interface AutopilotTaskResult {
  // 게시할 내용 없으면 skip=true → 오케스트레이터가 전달 안 함(빈 알림 방지).
  skip: boolean;
  slackText?: string; // T0 전달 본문.
}

export interface AutopilotTask {
  readonly id: string;
  run(context: AutopilotTaskContext): Promise<AutopilotTaskResult>;
}
