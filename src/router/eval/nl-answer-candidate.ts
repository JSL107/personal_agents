import { NL_ANSWER_EVAL_CASES } from './nl-answer-eval.cases';

// 운영 원장에서 "질문에 제대로 답하지 못했을 수 있는" 자연어 회차를 골라, 사람이 보고 eval holdout 에
// 보탤 후보로 내놓는다. 자동으로 문항을 만들지 않는다 — 기대 답(채점 기준)은 사람이 정해야 한다.
// (plan: docs/superpowers/plans/2026-10-07-nl-answer-fidelity.md §2 「과최적화 방지」·§5 「표본 부족」)

export type CandidateReason =
  // 사실 기반 답을 못 내고 결정론 요약으로 대신 답했다(답 생성 실패·숫자 검사 실패).
  | 'FALLBACK'
  // 질문·가정형이라 쓰기를 보류했다 — 사용자가 실제로 기록을 원했을 수도 있다.
  | 'HELD_WRITE'
  // 분류기가 담당을 못 골라 대화 답변으로 갔다.
  | 'UNCLASSIFIED'
  // 사실 기반 답을 냈다 — 답의 질을 사람이 표본으로 본다.
  | 'FACT_ANSWER';

export interface LedgerRunRow {
  id: number;
  agentType: string;
  startedAt: Date;
  inputSnapshot: unknown;
  output: unknown;
}

export interface NlAnswerCandidate {
  agentRunId: number;
  startedAt: string;
  worker: string;
  text: string;
  reason: CandidateReason;
  detail?: string;
}

// eval 문항과 같은 원문은 후보에서 뺀다(멘션·공백 차이는 무시).
const normalize = (text: string): string =>
  text
    .replace(/<@[A-Z0-9]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const KNOWN_TEXTS: ReadonlySet<string> = new Set(
  NL_ANSWER_EVAL_CASES.map((evalCase) => normalize(evalCase.text)),
);

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};

export const toNlAnswerCandidate = (
  row: LedgerRunRow,
  knownTexts: ReadonlySet<string> = KNOWN_TEXTS,
): NlAnswerCandidate | null => {
  const snapshot = asRecord(row.inputSnapshot);
  const output = asRecord(row.output);
  const text =
    typeof snapshot.routedText === 'string' ? snapshot.routedText : '';
  // 원문이 없으면(슬래시·cron) 자연어 회차가 아니다.
  if (text.trim().length === 0 || knownTexts.has(normalize(text))) {
    return null;
  }
  const base = {
    agentRunId: row.id,
    startedAt: row.startedAt.toISOString(),
    worker: row.agentType,
    text,
  };
  if (row.agentType === 'ROUTER' && output.outcome === 'UNCLASSIFIED') {
    return { ...base, reason: 'UNCLASSIFIED' };
  }
  if (snapshot.action !== 'UNKNOWN') {
    return null;
  }
  if (output.usedFallback === true) {
    const numberCheck = asRecord(output.numberCheck);
    const detail =
      typeof output.answerError === 'string'
        ? `답 생성 실패: ${output.answerError}`
        : Array.isArray(numberCheck.unexpected)
          ? `근거 없는 값: ${numberCheck.unexpected.join(', ')}`
          : undefined;
    return { ...base, reason: 'FALLBACK', ...(detail ? { detail } : {}) };
  }
  if (asRecord(snapshot.parsedIntent).heldWrite !== undefined) {
    return { ...base, reason: 'HELD_WRITE' };
  }
  return { ...base, reason: 'FACT_ANSWER' };
};
