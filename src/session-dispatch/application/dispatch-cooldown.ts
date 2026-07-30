// 세션별 최근 제안 시각을 in-memory 로 추적해 재제안 최소 간격을 강제한다(스팸 방지).
// best-effort — 재시작 시 리셋(열린 제안 dedup 이 2차 방어). 시계는 주입.
export class DispatchCooldown {
  private readonly lastProposedAt = new Map<string, number>();

  constructor(
    private readonly cooldownMs: number,
    private readonly now: () => number,
  ) {}

  shouldSkip(sessionId: string): boolean {
    const last = this.lastProposedAt.get(sessionId);
    if (last === undefined) {
      return false;
    }

    return this.now() - last < this.cooldownMs;
  }

  mark(sessionId: string): void {
    this.lastProposedAt.set(sessionId, this.now());
  }
}
