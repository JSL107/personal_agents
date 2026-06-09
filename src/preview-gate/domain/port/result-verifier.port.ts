import { VerifiableArtifact } from '../apply-result.type';

// PreviewApplier 가 apply 후 채운 VerifiableArtifact 를 실제 반영됐는지 재조회 검증하는 strategy.
// PreviewApplier 와 대칭 — RESULT_VERIFIERS 토큰으로 multi-provider 등록, ApplyPreviewUsecase 가
// apply 성공 후 artifact 별 verifier 를 찾아 verify 호출. RouterModule/PreviewGate 가 useFactory
// 로 중앙 inject (분산 multi-provider 회피, AGENT_DISPATCHER_PORT 와 동일 패턴).
export const RESULT_VERIFIERS = Symbol('RESULT_VERIFIERS');

export interface VerificationOutcome {
  // 실제 반영이 재조회로 확인됐는가.
  verified: boolean;
  // 사용자 안내 문구 (예: "PR #707 반영 확인").
  detail: string;
  // 재조회 자체가 불가했던 경우의 사유 (네트워크 오류 등) — 실패(verified=false)와 구분.
  // 있으면 "확인 불가" 로 안내 (작업이 실패했다는 의미는 아님).
  unverifiableReason?: string;
}

export interface ResultVerifier {
  // 이 verifier 가 처리할 artifact type 인지.
  supports(artifact: VerifiableArtifact): boolean;
  // 단일 artifact 의 실제 반영을 재조회로 검증. 재조회 실패는 throw 가 아니라
  // VerificationOutcome 으로 흡수 (apply 자체는 이미 성공했으므로 안내만 달라진다).
  verify(artifact: VerifiableArtifact): Promise<VerificationOutcome>;
}
