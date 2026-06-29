export const AUTOPILOT_TASKS = Symbol('AUTOPILOT_TASKS');

export interface AutopilotTaskContext {
  ownerSlackUserId: string;
  firedAtKst: string; // 오케스트레이터가 getTodayKstDate() 로 1회 계산해 주입.
}

export interface AutopilotTaskResult {
  // 게시할 내용 없으면 skip=true → 오케스트레이터가 전달 안 함(빈 알림 방지).
  skip: boolean;
  // 메인 메시지에 합쳐질 요약 본문 (T0 전달).
  summaryText?: string;
  // 있으면 메인 메시지의 스레드 댓글로 발송될 상세 본문. 없으면 요약만.
  detailText?: string;
}

export interface AutopilotTask {
  readonly id: string;
  run(context: AutopilotTaskContext): Promise<AutopilotTaskResult>;
}
