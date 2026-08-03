import { PrismaClient } from '@prisma/client';

import { AGENT_CONTRACTS } from '../src/agent-registry/agent-contract';
import { inspectContract } from '../src/agent-registry/contract-inspector';
import { AgentType } from '../src/model-router/domain/model-router.type';

/**
 * 이미 저장된 산출물에 직무 계약 검수기를 돌려 위반 분포를 본다.
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
}

const main = async (): Promise<void> => {
  const runs = await prisma.agentRun.findMany({
    where: { status: 'SUCCEEDED' },
    select: { agentType: true, output: true },
  });

  const tallies = new Map<string, AgentTally>();

  for (const run of runs) {
    const agentType = run.agentType as AgentType;
    if (!(agentType in AGENT_CONTRACTS)) {
      continue;
    }

    const tally = tallies.get(agentType) ?? {
      total: 0,
      violated: 0,
      byRule: new Map<string, number>(),
    };
    tally.total += 1;

    const violations = inspectContract(agentType, run.output);
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

  console.log('에이전트별 계약 위반 분포 (성공 실행 대상)\n');
  for (const [agentType, tally] of rows) {
    const rate = ((tally.violated / tally.total) * 100).toFixed(0);
    console.log(`${agentType}  ${tally.violated}/${tally.total} (${rate}%)`);
    const details = [...tally.byRule.entries()].sort(
      (left, right) => right[1] - left[1],
    );
    for (const [key, count] of details) {
      console.log(`    ${key} — ${count}건`);
    }
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
