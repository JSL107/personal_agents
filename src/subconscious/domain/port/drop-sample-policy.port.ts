export const DROP_SAMPLE_POLICY = Symbol('DROP_SAMPLE_POLICY');

// legacy 게이트가 버린(promote=false) 변경을 사람 판정에 섞는 비율과 상한.
// 버린 영역의 정답이 없으면 어떤 게이트가 더 나은지 영영 비교할 수 없다(사람 판정은 올린 카드에만
// 달린다). 시간당 승격 예산과는 별도 — 표본이 진짜 제안을 밀어내지 않게 한다.
export interface DropSamplePolicy {
  // 0 이면 비활성.
  readonly rate: number;
  // KST 하루에 만들 수 있는 표본 카드 수.
  readonly dailyCap: number;
  // [0, 1) — 테스트에서 고정하려고 주입한다.
  readonly random: () => number;
}
