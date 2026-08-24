import { PrismaClient } from '@prisma/client';

import { AGENT_CONTRACTS } from '../src/agent-registry/agent-contract';
import { evaluateContract } from '../src/agent-registry/contract-inspector';
import { formatKstDate } from '../src/common/util/kst-date.util';
import { AgentType } from '../src/model-router/domain/model-router.type';

/**
 * 이미 저장된 산출물에 직무 계약 검수기를 돌려 위반 분포와 점수를 본다.
 *
 * **여기의 점수는 `agent_run.contract_score`(실행 당시 기록) 가 아니라 저장된 output 에
 * 지금 계약을 다시 적용한 값이다.** 계약을 고치면 과거 점수도 함께 움직인다 — 이 스크립트의
 * 목적이 "새 계약이 과한지" 를 보는 것이라 그게 맞는 동작이지만, 실행 당시 품질의 시계열로
 * 읽으면 안 된다. 그 시계열은 `contract_score` 컬럼을 직접 조회해야 하고, 컬럼이 2026-08-24
 * 에 추가돼 그 이전 실행은 전부 NULL 이다.
 *
 * 두 시점에 쓴다.
 *   1. 계약을 새로 쓰거나 고친 직후 — 계약이 과한지(정상 산출물이 무더기로 걸리는지) 확인
 *   2. 관측 모드를 얼마간 돌린 뒤 — 차단 모드로 전환할지 판단
 *
 * 실행: `pnpm exec ts-node scripts/check-contract-violations.ts`
 */

const prisma = new PrismaClient();

interface AgentTally {
  total: number;
  violated: number;
  byRule: Map<string, number>;
  /** 점수가 매겨진 실행 수(스텁 계약은 검사 항목이 0 개라 점수가 없다). */
  scored: number;
  scoreSum: number;
}

/** 주 단위 점수 버킷 — 산출물 품질이 나빠지는 추세를 보기 위한 축. */
interface WeekTally {
  scored: number;
  scoreSum: number;
}

/**
 * 주 시작(월요일) 날짜 문자열. 점수 추이의 x 축이다.
 *
 * `started_at` 은 UTC 로 저장되므로 KST 캘린더일로 옮긴 뒤 주 경계를 잡는다. UTC 로 그냥
 * 자르면 한국 시간 오전 9 시 이전의 실행이 전날·전주로 밀려 추이가 실제와 어긋난다.
 */
const weekKey = (date: Date): string => {
  const kstDate = formatKstDate(date.toISOString());
  if (kstDate === null) {
    return '날짜없음';
  }
  // KST 캘린더일을 UTC 자정으로 다시 세워 요일 계산에 시간대가 끼어들지 않게 한다.
  const base = new Date(`${kstDate}T00:00:00Z`);
  const weekday = (base.getUTCDay() + 6) % 7;
  base.setUTCDate(base.getUTCDate() - weekday);
  return base.toISOString().slice(0, 10);
};

const main = async (): Promise<void> => {
  const runs = await prisma.agentRun.findMany({
    where: { status: 'SUCCEEDED' },
    select: { agentType: true, output: true, startedAt: true },
  });

  const tallies = new Map<string, AgentTally>();
  const weeks = new Map<string, WeekTally>();

  for (const run of runs) {
    const agentType = run.agentType as AgentType;
    if (!(agentType in AGENT_CONTRACTS)) {
      continue;
    }

    const tally = tallies.get(agentType) ?? {
      total: 0,
      violated: 0,
      byRule: new Map<string, number>(),
      scored: 0,
      scoreSum: 0,
    };
    tally.total += 1;

    const evaluation = evaluateContract(agentType, run.output);
    const violations = evaluation.violations;
    if (evaluation.score !== null) {
      tally.scored += 1;
      tally.scoreSum += evaluation.score;
      const key = weekKey(run.startedAt);
      const week = weeks.get(key) ?? { scored: 0, scoreSum: 0 };
      week.scored += 1;
      week.scoreSum += evaluation.score;
      weeks.set(key, week);
    }
    if (violations.length > 0) {
      tally.violated += 1;
      for (const violation of violations) {
        const key = `${violation.rule}:${violation.detail}`;
        tally.byRule.set(key, (tally.byRule.get(key) ?? 0) + 1);
      }
    }

    tallies.set(agentType, tally);
  }

  const rows = [...tallies.entries()].sort(
    (left, right) => right[1].violated - left[1].violated,
  );

  console.log(
    '에이전트별 계약 위반 분포와 점수 (성공 실행 대상)\n' +
      '※ 점수는 저장된 산출물에 **지금 계약**을 다시 적용한 값이다 —\n' +
      '  실행 당시 기록(agent_run.contract_score)이 아니므로 계약을 고치면 과거 값도 움직인다.\n',
  );
  let unscoredRuns = 0;
  for (const [agentType, tally] of rows) {
    const rate = ((tally.violated / tally.total) * 100).toFixed(0);
    // 점수가 없는 실행은 "무검사" 로 따로 세운다. 평균에 섞으면 스텁 계약이
    // 만점처럼 보여 계약을 채워야 할 워커가 눈에서 사라진다.
    const score =
      tally.scored === 0
        ? '점수없음(무검사)'
        : `평균 ${(tally.scoreSum / tally.scored).toFixed(3)} (${tally.scored}/${tally.total}건 채점)`;
    unscoredRuns += tally.total - tally.scored;
    console.log(
      `${agentType}  위반 ${tally.violated}/${tally.total} (${rate}%)  ${score}`,
    );
    const details = [...tally.byRule.entries()].sort(
      (left, right) => right[1] - left[1],
    );
    for (const [key, count] of details) {
      console.log(`    ${key} — ${count}건`);
    }
  }

  const totalRuns = [...tallies.values()].reduce(
    (sum, tally) => sum + tally.total,
    0,
  );
  console.log(
    `\n무검사 실행 ${unscoredRuns}/${totalRuns}건 — 계약이 스텁이라 점수가 매겨지지 않은 실행이다.`,
  );

  console.log(
    '\n주별 평균 점수 추이 (KST 월요일 기준, 현재 계약으로 재평가)\n',
  );
  const weekRows = [...weeks.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  );
  for (const [week, tally] of weekRows) {
    const average = tally.scoreSum / tally.scored;
    // 눈으로 추세를 읽을 수 있게 막대를 붙인다(20 칸 = 1.000).
    const bar = '█'.repeat(Math.round(average * 20));
    console.log(`${week}  ${average.toFixed(3)}  ${bar} (${tally.scored}건)`);
  }
};

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
