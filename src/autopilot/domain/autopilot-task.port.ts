import { PreviewKind } from '../../preview-gate/domain/preview-action.type';

export const AUTOPILOT_TASKS = Symbol('AUTOPILOT_TASKS');

export interface AutopilotTaskContext {
  ownerSlackUserId: string;
  firedAtKst: string; // 오케스트레이터가 getTodayKstDate() 로 1회 계산해 주입.
}

// T1_PREVIEW task 가 orchestrator 에 올리는 preview 생성 요청. orchestrator 가 CreatePreviewUsecase 로 변환.
export interface AutopilotPreviewRequest {
  kind: PreviewKind;
  payload: unknown;
  previewText: string;
}

export interface AutopilotTaskResult {
  // 게시할 내용 없으면 skip=true → 오케스트레이터가 전달 안 함(빈 알림 방지).
  skip: boolean;
  // 메인 메시지에 합쳐질 요약 본문 (T0 전달).
  summaryText?: string;
  // 있으면 메인 메시지의 스레드 댓글로 발송될 상세 본문. 없으면 요약만.
  detailText?: string;
  // T1_PREVIEW 전용 — 있으면 orchestrator 가 PreviewGate 승인 버튼 발송.
  preview?: AutopilotPreviewRequest;
  // T1_PREVIEW 전용 — 있으면 orchestrator 가 preview 단수와 합쳐 각각 PreviewGate 카드 발송.
  // 단수 preview 와 병행 가능(둘 다 있으면 둘 다 발송). 한 task 가 카드 여러 장을 낼 때 사용.
  previews?: AutopilotPreviewRequest[];
}

export interface AutopilotTask {
  readonly id: string;
  run(context: AutopilotTaskContext): Promise<AutopilotTaskResult>;
}
