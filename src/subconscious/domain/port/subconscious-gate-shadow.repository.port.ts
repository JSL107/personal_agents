export const SUBCONSCIOUS_GATE_SHADOW_REPOSITORY = Symbol(
  'SUBCONSCIOUS_GATE_SHADOW_REPOSITORY',
);

// shadow 판정 원장 한 행 = 변경 하나에 대한 shadow 모델(Kev/Jev) 점수 + 같은 회차 legacy 판정.
// 문턱 보정(`pnpm subconscious:calibrate`)이 사람 판정과 조인해 읽는다. append-only.
export interface SubconsciousGateShadowRecord {
  readonly changeKey: string;
  readonly sourceId: string;
  readonly kind: string;
  // 이미 PII 레댁션된 summary 만 받는다 (RedactedChange.summary).
  readonly summary: string;
  readonly shadowModel: string;
  readonly promoteProbability: number | null;
  readonly agentChoice: string | null;
  readonly agentConfidence: number | null;
  readonly legacyPromote: boolean | null;
  readonly legacyAgent: string | null;
  readonly error: string | null;
}

export interface SubconsciousGateShadowRepository {
  recordMany(records: readonly SubconsciousGateShadowRecord[]): Promise<void>;
}
