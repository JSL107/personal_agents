import {
  EvalCase,
  EvalRunRecord,
  EvalScore,
  EvalSplit,
} from './nl-answer-eval.type';

// 개인 봇이 범용 챗봇처럼 답한 흔적. 어느 문항이든 나오면 실패다(2026-08-13·19 실례).
// 슬래시 명령 안내도 자연어 대화에서는 금지(대화 답변 프롬프트의 기존 규칙)라 함께 본다.
export const GENERIC_CHATBOT_PATTERNS: readonly RegExp[] = [
  /고객사/,
  /타인의?\s*(?:비공개\s*)?금융/,
  /(?:^|[\s`(])\/(?:[a-z][a-z-]+|휴가)(?=[\s`)]|$)/m,
];

// 봇 응답 끝에 붙는 실행 꼬리표("_이대리 (VACATION) · agentRunId=7479_")는 비교에서 뺀다.
const FOOTER = /_이대리 \([^)]*\)[^_]*_/g;
const normalize = (text: string): string =>
  text.replace(FOOTER, '').replace(/\s+/g, ' ').trim();

const endsWithQuestion = (text: string): boolean =>
  /[?？]\s*$/.test(normalize(text));

const includesArgs = (
  args: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean =>
  Object.entries(expected).every(([key, value]) => args[key] === value);

export const scoreRun = (evalCase: EvalCase, run: EvalRunRecord): EvalScore => {
  const failures: string[] = [];
  const expect = evalCase.expect;
  const text = run.text ?? '';
  const answered = run.outcome === 'WORKER_RAN' || run.outcome === 'REPLIED';

  if (
    expect.destinations !== undefined &&
    (run.destination === undefined ||
      !expect.destinations.includes(run.destination))
  ) {
    failures.push(
      `출처 ${run.destination ?? '없음'} — 기대 ${expect.destinations.join('|')}`,
    );
  }

  if (expect.forbidIntercepts === true && run.intercepts.length > 0) {
    failures.push(
      `쓰기·외부 실행 시도: ${run.intercepts.map((intercept) => intercept.name).join(', ')}`,
    );
  }

  if (expect.mustIntercept !== undefined) {
    const { name, argsInclude } = expect.mustIntercept;
    const hit = run.intercepts.some(
      (intercept) =>
        intercept.name === name &&
        (argsInclude === undefined ||
          includesArgs(intercept.args, argsInclude)),
    );
    if (!hit) {
      failures.push(`기대한 실행 없음: ${name}`);
    }
  }

  // 답 텍스트를 보는 검사는 실제로 답이 나간 회차에만 의미가 있다. 가로챈 회차는 대조군처럼
  // 실행 자체가 기대인 경우가 있어, 텍스트 검사가 있는 문항에서만 실패로 센다.
  const hasTextChecks =
    (expect.mustMatch?.length ?? 0) > 0 ||
    (expect.mustNotMatch?.length ?? 0) > 0 ||
    expect.notEndWithQuestion === true ||
    expect.differFromPriorBot === true;
  // 실행하지 않는 워커로 간 회차는 운영이라면 그 워커가 실제로 일을 했다 — 되묻기가 아니므로
  // 텍스트 검사는 판정하지 않는다(요약의 stubRouted 로 따로 센다). 출처 검사는 위에서 이미 했다.
  if (hasTextChecks && !answered && run.outcome !== 'STUB_ROUTED') {
    failures.push(`답이 나가지 않음 (${run.outcome})`);
  }

  if (answered) {
    for (const pattern of expect.mustMatch ?? []) {
      if (!pattern.test(text)) {
        failures.push(`필요한 표현 없음: ${pattern.source}`);
      }
    }
    for (const pattern of [
      ...GENERIC_CHATBOT_PATTERNS,
      ...(expect.mustNotMatch ?? []),
    ]) {
      if (pattern.test(text)) {
        failures.push(`금지 표현: ${pattern.source}`);
      }
    }
    if (expect.notEndWithQuestion === true && endsWithQuestion(text)) {
      failures.push('되묻기로 끝남');
    }
    if (expect.differFromPriorBot === true) {
      const priorBot = [...(evalCase.priorTurns ?? [])]
        .reverse()
        .find((turn) => turn.role === 'assistant');
      if (
        priorBot !== undefined &&
        normalize(priorBot.text) === normalize(text)
      ) {
        failures.push('직전 봇 응답을 그대로 되풀이');
      }
    }
  }

  if (run.outcome === 'ERROR' && expect.mustIntercept === undefined) {
    failures.push(`오류: ${text.slice(0, 120)}`);
  }

  return { pass: failures.length === 0, failures };
};

export interface EvalCaseSummary {
  caseId: string;
  split: EvalSplit;
  runs: number;
  passes: number;
  // 실행하지 않는 워커로 간 회차 수 — 텍스트 검사 없이 통과했을 수 있어 따로 보인다.
  stubRouted: number;
  // 3회 중 2회처럼 과반 이상 통과하면 충족.
  satisfied: boolean;
  failures: string[];
}

export interface EvalSplitSummary {
  split: EvalSplit;
  cases: number;
  satisfied: number;
}

export const summarizeCase = (
  evalCase: EvalCase,
  runs: EvalRunRecord[],
): EvalCaseSummary => {
  const scores = runs.map((run) => scoreRun(evalCase, run));
  const passes = scores.filter((score) => score.pass).length;
  return {
    caseId: evalCase.id,
    split: evalCase.split,
    runs: runs.length,
    passes,
    stubRouted: runs.filter((run) => run.outcome === 'STUB_ROUTED').length,
    satisfied: runs.length > 0 && passes * 2 > runs.length,
    failures: [...new Set(scores.flatMap((score) => score.failures))],
  };
};

export const summarizeSplits = (
  summaries: EvalCaseSummary[],
): EvalSplitSummary[] =>
  (['tuning', 'holdout'] as const).map((split) => {
    const inSplit = summaries.filter((summary) => summary.split === split);
    return {
      split,
      cases: inSplit.length,
      satisfied: inSplit.filter((summary) => summary.satisfied).length,
    };
  });
