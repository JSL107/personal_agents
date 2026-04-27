import {
  CreatePreviewInput,
  PreviewAction,
  PreviewStatus,
} from '../preview-action.type';

export const PREVIEW_ACTION_REPOSITORY_PORT = Symbol(
  'PREVIEW_ACTION_REPOSITORY_PORT',
);

export interface PreviewActionRepositoryPort {
  // 새 preview 를 PENDING 상태로 생성. id 는 어댑터가 uuid 생성. expiresAt 은 ttlMs 기반 계산.
  create(input: CreatePreviewInput): Promise<PreviewAction>;
  findById(id: string): Promise<PreviewAction | null>;
  // PENDING → status 전이. appliedAt / cancelledAt 은 status 에 맞춰 채워진다.
  // 멱등성: 이미 APPLIED/CANCELLED/EXPIRED 인 row 는 호출자 (usecase) 가 미리 검증해 막는다.
  transition(input: {
    id: string;
    status: Exclude<PreviewStatus, 'PENDING'>;
  }): Promise<PreviewAction>;
}
