import { ROUTED_TEXT_TRUNCATION_MARK } from '../../agent-run/application/routing-context';
import { NL_ANSWER_EVAL_CASES } from './nl-answer-eval.cases';

// 운영 원장에서 "질문에 제대로 답하지 못했을 수 있는" 자연어 회차를 골라, 사람이 보고 eval holdout 에
// 보탤 후보로 내놓는다. 자동으로 문항을 만들지 않는다 — 기대 답(채점 기준)은 사람이 정해야 한다.
// (plan: docs/superpowers/plans/2026-10-07-nl-answer-fidelity.md §2 「과최적화 방지」·§5 「표본 부족」)

export type CandidateReason =
  // 사용자가 답에 👎 를 달았다 — 실패를 사람이 직접 표시한 가장 직접적인 신호.
  | 'DISLIKED'
  // 처리 중 오류로 끝났다 — 사용자는 답 대신 오류를 받았다.
  | 'FAILED'
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
  status: string;
  startedAt: Date;
  inputSnapshot: unknown;
  output: unknown;
}

// 👎 반응 행(slack_reaction_signal). promptText 는 반응 대상이 스레드 답글일 때만 있다.
export interface DislikedReplyRow {
  messageTs: string;
  messageText: string;
  promptText: string | null;
}

export interface NlAnswerCandidate {
  // 👎 반응을 원장 run 에 잇지 못하면 null — 질문·답은 반응 행만으로 낸다.
  agentRunId: number | null;
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

// 원장의 라우팅 원문은 500자에서 잘리고 표식이 붙는다(toLedgerRoutedText) — 잘린 원문은 앞부분으로 맞춘다.
const isSameUtterance = (routedText: string, promptText: string): boolean => {
  const routed = normalize(routedText);
  const prompt = normalize(promptText);
  return routed.endsWith(ROUTED_TEXT_TRUNCATION_MARK)
    ? prompt.startsWith(routed.slice(0, -ROUTED_TEXT_TRUNCATION_MARK.length))
    : routed === prompt;
};

const ANSWER_PREVIEW_LENGTH = 160;

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
  // 실패한 회차는 output 이 비어 아래 갈래에 걸리지 않고 "사실 답을 냄" 으로 잘못 세어진다(#755 리뷰).
  if (row.status === 'FAILED') {
    return { ...base, reason: 'FAILED' };
  }
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

// 👎 반응 → 후보. 원장에는 Slack 메시지 ts 가 없어 반응과 run 을 직접 잇는 키가 없다. 그래서 질문 원문이
// 같고 답이 게시되기 전에 시작한 가장 최근 run 을 그 답의 run 으로 본다. 같은 문장을 두 번 물었다면
// 더 최근 회차가 잡힌다 — 질문·답 본문은 반응 행의 것이라 사람이 읽는 내용은 틀리지 않는다.
export const toDislikedCandidate = (
  signal: DislikedReplyRow,
  runs: readonly LedgerRunRow[],
  knownTexts: ReadonlySet<string> = KNOWN_TEXTS,
): NlAnswerCandidate | null => {
  const prompt = signal.promptText;
  // 질문이 없으면(최상위 cron 발송 등) 대화 답변이 아니다.
  if (!prompt || prompt.trim().length === 0) {
    return null;
  }
  if (knownTexts.has(normalize(prompt))) {
    return null;
  }
  const answeredAt = new Date(Number(signal.messageTs) * 1_000);
  const run = runs
    .filter((row) => {
      const routedText = asRecord(row.inputSnapshot).routedText;
      return (
        typeof routedText === 'string' &&
        row.startedAt.getTime() <= answeredAt.getTime() &&
        isSameUtterance(routedText, prompt)
      );
    })
    .reduce<LedgerRunRow | undefined>(
      (latest, row) =>
        latest === undefined || row.startedAt > latest.startedAt ? row : latest,
      undefined,
    );
  const answer = signal.messageText.replace(/\s+/g, ' ').trim();
  return {
    agentRunId: run?.id ?? null,
    startedAt: (run?.startedAt ?? answeredAt).toISOString(),
    worker: run?.agentType ?? 'run 미연결',
    text: normalize(prompt),
    reason: 'DISLIKED',
    detail: `답: ${answer.length > ANSWER_PREVIEW_LENGTH ? `${answer.slice(0, ANSWER_PREVIEW_LENGTH)}…` : answer}`,
  };
};
