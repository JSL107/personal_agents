import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { ROUTED_TEXT_TRUNCATION_MARK } from '../src/agent-run/application/routing-context';
import { DEFAULT_EMBED_MODEL } from '../src/episodic-memory/episodic-memory.module';
import { EpisodicMemoryPrismaRepository } from '../src/episodic-memory/infrastructure/episodic-memory.prisma.repository';
import { LocalEmbedder } from '../src/episodic-memory/infrastructure/local-embedder.adapter';
import { normalizeRoutingText } from '../src/router/domain/routing-memory.policy';

// 일회성 백필: 라우팅 기억(routing_example)을 과거 원장에서 채운다.
// 설계: docs/superpowers/plans/2026-11-02-routing-memory-shortcut.md
//
// 운영 저장 조건(라우터 rememberRoutingExample)과 같은 것만 고른다: 분류기 경로 · SUCCEEDED ·
// 실제 run 담당 = 분류 결과 · 잘리지 않은 원문. 원장에는 직전 대화 유무가 없어 parent_id 가 없는
// 행만 쓴다(보수적 근사 — 단독으로 뜻이 서는 후속 턴 일부를 잃는다).
// 멱등: 같은 agent_run_id 의 routing_example 이 있으면 건너뛴다(운영 저장도 같은 키).
//
//   pnpm exec ts-node scripts/backfill-routing-examples.ts            # 미리보기(변경 없음, 원문 미출력)
//   pnpm exec ts-node scripts/backfill-routing-examples.ts --apply    # 임베딩 후 추가, 넣은 id 기록

const APPLY = process.argv.includes('--apply');
const BACKUP_DIR = join(homedir(), '.idaeri-backups');

interface Row {
  id: number;
  agent_type: string;
  status: string;
  routed_to: string | null;
  routed_text: string | null;
  parent_id: number | null;
  ended_at: Date | null;
  already: boolean;
}

type Skip =
  | 'FAILED'
  | 'UNKNOWN'
  | 'TYPE_MISMATCH'
  | 'TRUNCATED_OR_EMPTY'
  | 'HAS_PARENT'
  | 'ALREADY_STORED';

const skipReason = (row: Row): Skip | null => {
  if (row.status !== 'SUCCEEDED' || row.ended_at === null) {
    return 'FAILED';
  }
  if (row.routed_to === 'UNKNOWN') {
    return 'UNKNOWN';
  }
  if (row.routed_to !== row.agent_type) {
    return 'TYPE_MISMATCH';
  }
  const text = row.routed_text ?? '';
  if (
    text.endsWith(ROUTED_TEXT_TRUNCATION_MARK) ||
    normalizeRoutingText(text).length === 0
  ) {
    return 'TRUNCATED_OR_EMPTY';
  }
  if (row.parent_id !== null) {
    return 'HAS_PARENT';
  }
  return row.already ? 'ALREADY_STORED' : null;
};

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        r.id,
        r.agent_type,
        r.status,
        r.input_snapshot->>'routedTo' AS routed_to,
        r.input_snapshot->>'routedText' AS routed_text,
        r.parent_id,
        r.ended_at,
        EXISTS (
          SELECT 1 FROM episodic_memory e
          WHERE e.kind = 'routing_example' AND e.agent_run_id = r.id
        ) AS already
      FROM agent_run r
      WHERE r.input_snapshot->>'routedVia' = 'classifier'
      ORDER BY r.started_at
    `;
    const counts = new Map<string, number>();
    const bump = (key: string): void => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };
    const targets: Row[] = [];
    for (const row of rows) {
      const reason = skipReason(row);
      bump(reason ?? 'WOULD_INSERT');
      if (reason === null) {
        targets.push(row);
      }
    }
    const byWorker = new Map<string, number>();
    for (const row of targets) {
      byWorker.set(row.agent_type, (byWorker.get(row.agent_type) ?? 0) + 1);
    }
    const distinctTexts = new Set(
      targets.map(
        (row) =>
          `${row.agent_type}\u0000${normalizeRoutingText(row.routed_text ?? '')}`,
      ),
    ).size;

    console.log(
      `routing_example 백필 — ${APPLY ? 'APPLY' : 'DRY-RUN (변경 없음)'}`,
    );
    console.log(`분류기 경로 run ${rows.length}건`);
    for (const [key, count] of [...counts.entries()].sort()) {
      console.log(`  ${key.padEnd(20)} ${count}`);
    }
    console.log(
      `저장 예정 ${targets.length}건 (서로 다른 (문장, 담당) ${distinctTexts}) — 담당별: ${[
        ...byWorker.entries(),
      ]
        .sort((first, second) => second[1] - first[1])
        .map(([worker, count]) => `${worker} ${count}`)
        .join(', ')}`,
    );
    console.log(`대상 run id: ${targets.map((row) => row.id).join(',')}`);

    if (!APPLY) {
      console.log('\ndry-run — 적용하려면 --apply');
      return;
    }

    const embedder = new LocalEmbedder(
      // DI 밖 일회성 스크립트라 process.env 를 직접 읽는다(CODE_RULES §9 예외).
      process.env.EPISODIC_EMBED_MODEL ?? DEFAULT_EMBED_MODEL,
    );
    const repository = new EpisodicMemoryPrismaRepository(prisma as never);
    const inserted: number[] = [];
    for (const row of targets) {
      const content = normalizeRoutingText(row.routed_text ?? '');
      const [embedding] = await embedder.embed([content], 'query');
      await repository.insert({
        kind: 'routing_example',
        agentRunId: row.id,
        agentType: row.agent_type,
        content,
        embedding,
        // 시점 정직: 성공이 확정된 시각. 운영 저장도 성공 직후다.
        occurredAt: row.ended_at as Date,
      });
      inserted.push(row.id);
    }
    mkdirSync(BACKUP_DIR, { recursive: true });
    const logPath = join(
      BACKUP_DIR,
      `routing-example-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    writeFileSync(logPath, JSON.stringify({ agentRunIds: inserted }));
    console.log(
      `\n추가 ${inserted.length}건. 되돌리기: DELETE FROM episodic_memory WHERE kind='routing_example' AND agent_run_id IN (${logPath} 의 agentRunIds)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
