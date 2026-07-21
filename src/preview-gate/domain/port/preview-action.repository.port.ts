import {
  CreatePreviewInput,
  PreviewAction,
  PreviewStatus,
} from '../preview-action.type';

export const PREVIEW_ACTION_REPOSITORY_PORT = Symbol(
  'PREVIEW_ACTION_REPOSITORY_PORT',
);

// Ops Supervisor — kind 별 preview 종결 집계. reject = cancelled + expired.
export interface PreviewOutcomeRow {
  kind: string;
  applied: number;
  cancelled: number;
  expired: number;
}

export interface PreviewActionRepositoryPort {
  // 새 preview 를 PENDING 상태로 생성. id 는 어댑터가 uuid 생성. expiresAt 은 ttlMs 기반 계산.
  create(input: CreatePreviewInput): Promise<PreviewAction>;
  findById(id: string): Promise<PreviewAction | null>;
  // 사용자별 가장 최근 PENDING preview — 자연어 Y/N 응답 흐름에서
  // "응" / "아니" 입력을 어떤 preview 에 매핑할지 결정할 때 사용한다.
  // 만료된(expiresAt <= now) row 는 제외 (만료된 건 apply 불가).
  findLatestPendingForUser(input: {
    slackUserId: string;
    now: Date;
  }): Promise<PreviewAction | null>;
  // PENDING → status 전이. appliedAt / cancelledAt 은 status 에 맞춰 채워진다.
  // 멱등성: 이미 APPLIED/CANCELLED/EXPIRED 인 row 는 호출자 (usecase) 가 미리 검증해 막는다.
  transition(input: {
    id: string;
    status: Exclude<PreviewStatus, 'PENDING'>;
  }): Promise<PreviewAction>;
  countOutcomesByKind(input: {
    sinceDays: number;
    now: Date;
  }): Promise<PreviewOutcomeRow[]>;
}
