// Knowledge-Lint 포트 — episodic-memory 무결성 점검 결과.
// EpisodicMemoryPort(record/searchRelevant)와 분리한다: 소비자(autopilot)가 다르고,
// "소비자가 의존하는 좁은 인터페이스"인 기존 포트를 오염시키지 않기 위함(ISP).

export type KnowledgeLintIssueType =
  | 'near_duplicate'
  | 'embedding_null'
  | 'contradiction';

export interface KnowledgeLintIssue {
  type: KnowledgeLintIssueType;
  episodeId: number;
  relatedId?: number; // near_duplicate 짝 에피소드 id.
  detail: string; // 사람이 읽는 사유(예: "중복 후보 — distance 0.012").
  occurredAt: Date;
}

// L4 contradiction 옵션 — enabled 일 때만 거리 밴드 쌍을 LLM 판정한다.
export interface ContradictionLintOptions {
  enabled: boolean;
  maxPairs: number; // 주간 LLM 호출 상한(쿼터 가드).
  minDistance: number; // 밴드 하한(이보다 가까우면 L1 중복).
  maxDistance: number; // 밴드 상한(이보다 멀면 무관).
}

export interface LintEpisodicMemoryInput {
  // near-duplicate 판정 임계값(cosine distance). 이보다 가까운 쌍을 중복 후보로 본다.
  duplicateMaxDistance: number;
  // 이슈 종류별 최대 보고 개수(Slack digest 폭주 방지).
  limit: number;
  // L4 — 미지정/비활성 시 contradiction 점검 skip(L1/L2 만).
  l4?: ContradictionLintOptions;
}

// L4 실행 실태 — "모순을 몇 쌍 실제로 판정했나". 이슈 목록만으로는 알 수 없다:
// 쿼터 소진 중단(circuit break)과 개별 judge 실패는 둘 다 빈 결과로 수렴하므로
// "판정했고 모순 0건" 과 "판정을 못 했다" 가 구분되지 않는다. 그 구분을 여기서 낸다.
export interface ContradictionLintOutcome {
  // 거리 밴드 조회로 나온 후보 쌍 수. 0 이면 판정할 대상 자체가 없었다(정상).
  candidates: number;
  // judge 판정을 끝낸 쌍 수. candidates 와 다르면 부분 실패다.
  judged: number;
  // codex 쿼터 소진으로 남은 쌍을 포기했나.
  abortedByQuota: boolean;
}

export interface KnowledgeLintOutcome {
  issues: KnowledgeLintIssue[];
  // 임계값 이하 near_duplicate 쌍의 전체 수(dedup 후). issues 는 보고 상한(limit)으로 잘린
  // 목록이라 이 값과 다를 수 있다 — 그 차이를 알리지 않으면 화면의 건수가 곧 실제 규모로 읽힌다.
  duplicateTotal: number;
  // 조회가 스캔 상한에 걸려 duplicateTotal 이 하한값인가. 로그만으로는 부족하다 —
  // 화면에 뜨는 숫자가 확정 총계인지 "이 이상" 인지는 메시지를 보는 사람이 알아야 한다.
  duplicateTotalTruncated: boolean;
  // 오래된 쪽이라 정리(superseded_at)할 행 수 — 점검 단계에서는 세기만 한다. 실제로 찍는 것은
  // 알림 발송이 성공한 뒤(supersedeOlderDuplicates)다. duplicateTotal(쌍 수)과 다를 수 있다 —
  // 같은 글이 셋이면 두 행이 걸리고, 워커 종류(agent_type)가 다른 쌍은 보고만 하고 찍지 않는다.
  duplicateSupersedable: number;
  // L4 를 아예 수행하지 않았으면 null — 비활성(env) 또는 judge 미주입.
  // "점검 안 함(null)" 과 "점검했으나 일부 실패(judged < candidates)" 는 다른 사실이다.
  l4: ContradictionLintOutcome | null;
}

export interface KnowledgeLintPort {
  // 읽기 전용 — 아무 행도 바꾸지 않는다.
  lintIssues(input: LintEpisodicMemoryInput): Promise<KnowledgeLintOutcome>;
  // 중복의 오래된 쪽에 superseded_at 을 찍고 찍은 행 수를 돌려준다. 알림 발송 뒤에만 부른다 —
  // 발송 전에 찍으면 발송·후속 조회가 실패했을 때 정리 내역이 보고되지 않은 채 남고,
  // 재시도는 찍힌 행을 조회하지 않아 "이상 없음" 을 보낼 수 있다.
  supersedeOlderDuplicates(input: { maxDistance: number }): Promise<number>;
}

export const KNOWLEDGE_LINT_PORT = Symbol('KNOWLEDGE_LINT_PORT');
