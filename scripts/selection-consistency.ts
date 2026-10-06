import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';

import { parsePaperRecommendation } from '../src/agent/paper-recommend/domain/paper-recommendation.parser';
import {
  amountWeightedAgreement,
  blockBootstrapInterval,
  BlockValue,
  decideSelectionVerdict,
  executeBuys,
  ExecutedBuy,
  hasBuyingHeadroom,
  Interval,
  isoWeekKey,
  modalFrequency,
  pairwiseAgreement,
  parseRecommendationPrompt,
  RecommendationPromptInputs,
  ReplayAnswer,
  ruleAgreement,
} from '../src/backtest/domain/selection-consistency';
import {
  CodexCliProvider,
  CodexQuotaExceededException,
} from '../src/model-router/infrastructure/codex-cli.provider';

/**
 * 모의투자 추천의 종목 선정 일치도 측정 (설계 v3, 2026-10-06).
 *
 * 운영 원장에 아무것도 쓰지 않는다 — 이것이 이 스크립트의 첫 번째 계약이다.
 *   - Nest 를 띄우지 않는다. PrismaService 는 부팅 때 수동 인덱스 DDL 을 돌린다.
 *   - `ModelRouterUsecase.route()` 를 거치지 않고 codex provider 를 직접 부른다. route() 는
 *     `model_call` 을 남기고 codex 실패 시 Claude 로 폴백한다 — 둘 다 측정을 오염시킨다.
 *     PAPER_RECOMMEND 는 `skipPreamble` 이라 route() 도 머리말을 붙이지 않으므로 요청은 같다.
 *   - DB 는 `agent_run` 을 읽기만 한다. 결과는 `--file` 의 JSONL(레포 밖)에만 쓴다.
 *
 * 실행 — PrismaClient 는 `.env` 를 스스로 읽지 않으므로 `--env-file` 로 넘긴다:
 *   node --env-file=.env -r ts-node/register scripts/selection-consistency.ts ledger
 *   node --env-file=.env -r ts-node/register scripts/selection-consistency.ts baseline
 *   node --env-file=.env -r ts-node/register scripts/selection-consistency.ts sample --stage pilot|1|2 --file <path>
 *   node --env-file=.env -r ts-node/register scripts/selection-consistency.ts report --file <path>
 *
 * `sample` 만 모델을 부른다(구독 쿼터 소모). 끊겨도 같은 파일로 다시 돌리면 끝난 칸은 건너뛴다.
 */

const prisma = new PrismaClient();

// 단계별 회차당 반복 수. 1단계에서 ① 구간이 판정 칸에 들어가면 2단계는 돌리지 않는다.
const STAGE_REPEATS = { pilot: 3, '1': 2, '2': 3 } as const;
type Stage = keyof typeof STAGE_REPEATS;

interface EligibleRun {
  runId: number;
  strategy: string;
  decidedAt: Date;
  systemPrompt: string;
  prompt: string;
  inputs: RecommendationPromptInputs;
  maximumWeightPercent: number | undefined;
  storedOutput: unknown;
}

interface SampleRecord {
  runId: number;
  repeat: number;
  ok: boolean;
  text?: string;
  error?: string;
  modelUsed?: string;
  durationMs: number;
  at: string;
}

const loadEligibleRuns = async (): Promise<EligibleRun[]> => {
  const rows = await prisma.agentRun.findMany({
    where: { agentType: 'PAPER_RECOMMEND', status: 'SUCCEEDED' },
    orderBy: { id: 'asc' },
    select: { id: true, inputSnapshot: true, output: true },
  });
  return rows.flatMap((row) => {
    const snapshot = row.inputSnapshot as {
      strategy?: string;
      decidedAt?: string;
      systemPrompt?: string | null;
      prompt?: string | null;
      parameters?: { maximumWeightPercent?: number };
    };
    if (!snapshot.prompt || !snapshot.systemPrompt || !snapshot.decidedAt) {
      return [];
    }
    const inputs = parseRecommendationPrompt(snapshot.prompt);
    if (!hasBuyingHeadroom(inputs)) {
      return [];
    }
    return [
      {
        runId: row.id,
        strategy: snapshot.strategy ?? 'UNKNOWN',
        decidedAt: new Date(snapshot.decidedAt),
        systemPrompt: snapshot.systemPrompt,
        prompt: snapshot.prompt,
        inputs,
        // 2026-08-25 이전 회차는 값을 안 남겼다. 그때도 코드 상수 20% 였다.
        maximumWeightPercent: snapshot.parameters?.maximumWeightPercent,
        storedOutput: row.output,
      },
    ];
  });
};

const blockOf = (run: EligibleRun): string =>
  `${run.strategy}:${isoWeekKey(run.decidedAt)}`;

const countBy = (runs: EligibleRun[], strategy: string): number =>
  runs.filter((run) => run.strategy === strategy).length;

const runLedger = async (): Promise<void> => {
  // 측정 전후로 돌려 두 출력이 같으면 운영 원장에 섞인 것이 없다.
  const query = { _count: { _all: true }, _max: { id: true } } as const;
  const rows = [
    ['agent_run', await prisma.agentRun.aggregate(query)],
    ['model_call', await prisma.modelCall.aggregate(query)],
    ['screening_run', await prisma.screeningRun.aggregate(query)],
    ['screening_run_item', await prisma.screeningRunItem.aggregate(query)],
    ['paper_order', await prisma.paperOrder.aggregate(query)],
    ['recommendation_score', await prisma.recommendationScore.aggregate(query)],
  ] as const;
  for (const [table, row] of rows) {
    console.log(
      `${table}\tcount=${row._count._all}\tmax_id=${row._max.id ?? '없음'}`,
    );
  }
};

const runBaseline = async (): Promise<void> => {
  // 모델 호출 없이 운영이 실제로 낸 매수 주문으로 ④ 를 먼저 잰다. 원래 답 원문은 저장되지
  // 않아 제약 함수를 거친 주문만 남아 있다 — 그래서 이 값은 사전 측정이지 판정이 아니다.
  const runs = await loadEligibleRuns();
  const values: BlockValue[] = [];
  let abstained = 0;
  for (const run of runs) {
    const output = run.storedOutput as {
      orders?: { side: string; code: string }[];
    } | null;
    const executed: ExecutedBuy[] = (output?.orders ?? [])
      .filter((order) => order.side === 'BUY')
      .map((order) => ({ code: order.code, amount: 0 }));
    const agreement = ruleAgreement(executed, run.inputs);
    if (agreement === null) {
      abstained += 1;
      continue;
    }
    values.push({ block: blockOf(run), value: agreement });
  }
  console.log(
    `대상 회차 ${runs.length} (SWING ${countBy(runs, 'SWING')} · LONG_TERM ${countBy(runs, 'LONG_TERM')})`,
  );
  console.log(`운영 매수 0건(기권) ${abstained}회차 — ④ 계산에서 제외`);
  printInterval(
    '④ 규칙 일치 (운영 주문 기준, 사전 측정)',
    blockBootstrapInterval(values),
  );
};

const readRecords = (file: string): SampleRecord[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as SampleRecord)
    : [];

const appendRecord = (file: string, record: SampleRecord): void => {
  appendFileSync(file, `${JSON.stringify(record)}\n`);
};

const runSample = async (stage: Stage, file: string): Promise<void> => {
  const runs = await loadEligibleRuns();
  // 파일럿은 파싱·격리 점검용이라 가장 오래된 회차 하나만 부른다. 절차가 본 측정과 같으므로
  // 같은 파일로 1·2단계를 돌리면 그 답은 해당 칸에 그대로 재사용된다(다시 부르지 않는다).
  const targets = stage === 'pilot' ? runs.slice(0, 1) : runs;
  const repeats = STAGE_REPEATS[stage];
  const done = new Set(
    readRecords(file)
      .filter((record) => record.ok)
      .map((record) => `${record.runId}:${record.repeat}`),
  );
  const pending = targets
    .flatMap((run) =>
      Array.from({ length: repeats }, (_, index) => ({
        run,
        repeat: index + 1,
      })),
    )
    .filter(({ run, repeat }) => !done.has(`${run.runId}:${repeat}`));
  console.log(
    `stage=${stage} 대상 ${targets.length}회차 × ${repeats} — 남은 호출 ${pending.length}건`,
  );

  const provider = new CodexCliProvider();
  // 순차로 부른다. 구독과 CODEX_HOME 을 운영 앱과 같이 쓰므로 동시 spawn 은 운영 호출과
  // 경합할 수 있다.
  for (const [index, { run, repeat }] of pending.entries()) {
    const startedAt = Date.now();
    try {
      const completion = await provider.complete({
        prompt: run.prompt,
        systemPrompt: run.systemPrompt,
      });
      appendRecord(file, {
        runId: run.runId,
        repeat,
        ok: true,
        text: completion.text,
        modelUsed: completion.modelUsed,
        durationMs: Date.now() - startedAt,
        at: new Date().toISOString(),
      });
      console.log(
        `[${index + 1}/${pending.length}] run=${run.runId} #${repeat} ${Date.now() - startedAt}ms`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      appendRecord(file, {
        runId: run.runId,
        repeat,
        ok: false,
        error: message.slice(0, 500),
        durationMs: Date.now() - startedAt,
        at: new Date().toISOString(),
      });
      if (error instanceof CodexQuotaExceededException) {
        // 더 부르면 운영 추천 cron 이 Claude 로 폴백한다. 여기서 멈추고 나중에 이어 간다.
        console.error(
          `codex 쿼터 소진 — 중단. 같은 명령으로 이어서 돌리면 끝난 칸은 건너뛴다. ${error.resetHint ?? ''}`,
        );
        process.exitCode = 2;
        return;
      }
      console.error(
        `[${index + 1}/${pending.length}] run=${run.runId} #${repeat} 실패: ${message.slice(0, 200)}`,
      );
    }
  }
};

const answerOf = (text: string, run: EligibleRun): ReplayAnswer => {
  try {
    return executeBuys({
      recommendation: parsePaperRecommendation(text),
      inputs: run.inputs,
      maximumWeightPercent: run.maximumWeightPercent,
    });
  } catch {
    return null;
  }
};

const runReport = async (file: string): Promise<void> => {
  const runs = new Map(
    (await loadEligibleRuns()).map((run) => [run.runId, run]),
  );
  // 같은 칸을 다시 돌렸으면 마지막 성공을 쓴다.
  const textByCell = new Map<string, { runId: number; text: string }>();
  for (const record of readRecords(file)) {
    if (record.ok && record.text !== undefined) {
      textByCell.set(`${record.runId}:${record.repeat}`, {
        runId: record.runId,
        text: record.text,
      });
    }
  }
  const answersByRun = new Map<number, ReplayAnswer[]>();
  for (const { runId, text } of textByCell.values()) {
    const run = runs.get(runId);
    if (!run) {
      continue;
    }
    answersByRun.set(runId, [
      ...(answersByRun.get(runId) ?? []),
      answerOf(text, run),
    ]);
  }

  const consistency: BlockValue[] = [];
  const sensitivity: BlockValue[] = [];
  const rule: BlockValue[] = [];
  const modal: BlockValue[] = [];
  const amount: BlockValue[] = [];
  let answers = 0;
  let failures = 0;
  let abstentions = 0;
  let emptyPairs = 0;
  let pairs = 0;
  for (const [runId, runAnswers] of answersByRun) {
    const run = runs.get(runId);
    if (!run) {
      continue;
    }
    const block = blockOf(run);
    answers += runAnswers.length;
    failures += runAnswers.filter((answer) => answer === null).length;
    pushIfPresent(consistency, block, pairwiseAgreement(runAnswers));
    pushIfPresent(
      sensitivity,
      block,
      pairwiseAgreement(runAnswers, { failureAsAnswer: true }),
    );
    pushIfPresent(modal, block, modalFrequency(runAnswers));
    const parsed = runAnswers.filter(
      (answer): answer is ExecutedBuy[] => answer !== null,
    );
    abstentions += parsed.filter((answer) => answer.length === 0).length;
    const ruleValues = parsed.flatMap((answer) => {
      const value = ruleAgreement(answer, run.inputs);
      return value === null ? [] : [value];
    });
    pushIfPresent(rule, block, mean(ruleValues));
    const amountValues: number[] = [];
    for (let left = 0; left < parsed.length; left += 1) {
      for (let right = left + 1; right < parsed.length; right += 1) {
        pairs += 1;
        if (parsed[left].length === 0 && parsed[right].length === 0) {
          emptyPairs += 1;
        }
        amountValues.push(amountWeightedAgreement(parsed[left], parsed[right]));
      }
    }
    pushIfPresent(amount, block, mean(amountValues));
  }

  console.log(
    `회차 ${answersByRun.size} · 답 ${answers} · 파싱 실패 ${failures} · 매수 기권 ${abstentions} · 빈집합끼리 일치한 쌍 ${emptyPairs}/${pairs}`,
  );
  const consistencyInterval = blockBootstrapInterval(consistency);
  const ruleInterval = blockBootstrapInterval(rule);
  printInterval('① 체결 매수 완전일치 (주지표)', consistencyInterval);
  printInterval('④ 규칙 일치', ruleInterval);
  printInterval(
    '  민감도: 파싱 실패를 답으로 셈',
    blockBootstrapInterval(sensitivity),
  );
  printInterval('  금액 가중 일치', blockBootstrapInterval(amount));
  printInterval('  최빈 답 빈도', blockBootstrapInterval(modal));
  for (const strategy of ['SWING', 'LONG_TERM']) {
    const values = consistency.filter((value) =>
      value.block.startsWith(`${strategy}:`),
    );
    console.log(
      `  (서술용) ${strategy} ① 평균 ${formatNumber(mean(values.map((value) => value.value)))} — 회차 ${values.length}`,
    );
  }
  if (consistencyInterval === null || ruleInterval === null) {
    console.log('판정: 계산할 값이 없다');
    return;
  }
  console.log(
    `판정: ${decideSelectionVerdict({ consistency: consistencyInterval, rule: ruleInterval })}`,
  );
};

const pushIfPresent = (
  values: BlockValue[],
  block: string,
  value: number | null,
): void => {
  if (value !== null) {
    values.push({ block, value });
  }
};

const mean = (values: number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const formatNumber = (value: number | null): string =>
  value === null ? '없음' : value.toFixed(3);

const printInterval = (label: string, interval: Interval | null): void => {
  if (interval === null) {
    console.log(`${label}: 값 없음`);
    return;
  }
  console.log(
    `${label}: ${formatNumber(interval.mean)} [95% ${formatNumber(interval.lower)} ~ ${formatNumber(interval.upper)}] 회차 ${interval.values} · 블록 ${interval.blocks}`,
  );
};

const readOption = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const isStage = (value: string | undefined): value is Stage =>
  value !== undefined &&
  Object.prototype.hasOwnProperty.call(STAGE_REPEATS, value);

const main = async (): Promise<void> => {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'ledger') {
    await runLedger();
    return;
  }
  if (command === 'baseline') {
    await runBaseline();
    return;
  }
  const file = readOption(args, '--file');
  if (command === 'report' && file) {
    await runReport(file);
    return;
  }
  const stage = readOption(args, '--stage');
  if (command === 'sample' && file && isStage(stage)) {
    await runSample(stage, file);
    return;
  }
  throw new Error(
    '사용법: ledger | baseline | sample --stage pilot|1|2 --file <jsonl> | report --file <jsonl>',
  );
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
