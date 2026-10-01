import { PrismaClient } from '@prisma/client';

import { MANUAL_INDEX_STATEMENTS } from '../src/prisma/manual-index.sql';

// `pnpm db:push` 의 마지막 단계 — push 가 지운 수동 인덱스를 바로 되살린다.
//
// 앱도 부팅마다 같은 목록을 IF NOT EXISTS 로 만들지만, 다음 재시작까지는 인덱스 없이 돈다.
// 2026-09-30 하루 push 3회 모두 idx_episodic_memory_embedding 이 지워져 손으로 복구했다 —
// 사람이 기억해야 하는 절차는 결국 빠진다.
//
// AppModule 을 부팅하지 않는다 — 검증용 전체 부팅이 실행 중인 서비스의 repeatable job 을
// 지운 사고가 있었다(scripts/memory-vacuum.ts 참조). PrismaClient 만 직접 쓴다.
const readIndexNames = async (prisma: PrismaClient): Promise<Set<string>> => {
  const rows = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
  return new Set(rows.map((row) => row.indexname));
};

const main = async (): Promise<void> => {
  const prisma = new PrismaClient();
  try {
    const before = await readIndexNames(prisma);
    for (const statement of MANUAL_INDEX_STATEMENTS) {
      await prisma.$executeRawUnsafe(statement.sql);
    }
    const after = await readIndexNames(prisma);

    for (const { indexName } of MANUAL_INDEX_STATEMENTS) {
      if (!indexName) {
        continue;
      }
      if (!after.has(indexName)) {
        throw new Error(`${indexName} 를 만들지 못했다`);
      }
      console.log(
        before.has(indexName)
          ? `  유지 ${indexName}`
          : `  복구 ${indexName} (push 가 지운 것을 되살림)`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error: unknown) => {
  // push 는 이미 끝난 뒤라 여기서 조용히 넘어가면 인덱스 없이 도는 걸 아무도 모른다.
  console.error(
    `수동 인덱스 복구 실패 — 앱 재시작 또는 src/prisma/manual-index.sql.ts 의 SQL 을 직접 실행할 것: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
