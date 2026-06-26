// L4 knowledge-lint — 두 에피소드 기록의 의미 충돌 판정 포트.
export interface ContradictionVerdict {
  contradiction: boolean;
  reason: string;
}

export interface ContradictionJudgePort {
  judge(input: { textA: string; textB: string }): Promise<ContradictionVerdict>;
}

export const CONTRADICTION_JUDGE_PORT = Symbol('CONTRADICTION_JUDGE_PORT');
