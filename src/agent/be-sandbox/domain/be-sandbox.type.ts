// BE worker 의 BackendPlan 을 sandbox 안에서 검증하는 흐름의 payload.
// PreviewGate payload 로 직렬화되어 PENDING preview row 에 보관 → 사용자 ✅ 시 BeSandboxApplier 가 narrowing.
//
// Phase 2a-1 (scaffold): 실제 codex patch + git apply + pnpm test 는 미구현. sandbox echo 만.
// Phase 2a-2: 호스트 codex 로 unified diff 생성.
// Phase 2a-3: sandbox 안 git apply + pnpm install/test/build 실행.
export interface BeSandboxApplyPayload {
  // BE worker 가 생성한 BackendPlan 본문 — implementationChecklist / apiDesign / risks 등 합성 텍스트.
  planText: string;
  // 대상 repo 식별자 (예: "JSL107/personal_agents"). 향후 multi-repo 시 routing key.
  // Phase 2a-1 은 검증 안 함 — 그냥 echo 에 포함.
  repoLabel: string;
  // 베이스 브랜치. Phase 2b 의 PR push 시 base. 현재는 메타데이터로만 보관.
  baseBranch: string;
}

// Phase 2a-1 sandbox 호출 결과 — 호스트로 돌아오는 응답 shape.
export interface BeSandboxApplyResult {
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
  timedOut: boolean;
}

// payload validation — string 3종이 모두 비어 있지 않은지 확인.
// applier 가 첫 단계에서 호출 — 이상하면 PreviewActionException 으로 끊음.
export const isBeSandboxApplyPayload = (
  value: unknown,
): value is BeSandboxApplyPayload => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.planText === 'string' &&
    record.planText.trim().length > 0 &&
    typeof record.repoLabel === 'string' &&
    record.repoLabel.trim().length > 0 &&
    typeof record.baseBranch === 'string' &&
    record.baseBranch.trim().length > 0
  );
};
