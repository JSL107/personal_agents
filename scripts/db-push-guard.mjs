#!/usr/bin/env node
// `prisma db push` 는 호출한 worktree 의 schema.prisma 기준으로 DB 를 맞춘다. 그런데 로컬
// Postgres 는 worktree 전체가 공유하므로, 구버전 브랜치에서 돌리면 최신 브랜치가 추가한
// 컬럼을 DROP 하고 이미 폐지된 테이블을 되살린다.
//
// 2026-09-18 실제 사고: feat/console-calendar (구버전 스키마) 에서 push 가 돌아
// preview_action.last_failed_at · last_failure_reason 이 사라졌고, main 에서 돌던 앱의
// PreviewActionPrismaRepository.findAllOpen 이 죽어 GET /v1/console/snapshot 이 500 이 됐다.
// 컬럼이 비어 있으면 Prisma 내장 확인은 "데이터 손실 없음" 으로 보고 조용히 통과시키므로
// 그것만으로는 막히지 않는다.
//
// DROP INDEX 는 일부러 무시한다 — Prisma 스키마 문법으로 표현할 수 없어
// src/prisma/prisma.service.ts 의 onModuleInit 이 부팅마다 IF NOT EXISTS 로 되살리는
// 수동 인덱스라, 상시 drift 로 나오는 것이 정상이다.

import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const SCHEMA_PATH = 'prisma/schema.prisma';
const OVERRIDE_ENV = 'DB_PUSH_ALLOW_DROP';

// drift SQL 한 줄씩 보고 파괴적 구문만 골라낸다. DROP INDEX 는 위 주석의 이유로 제외.
function findDestructiveStatements(sql) {
  return sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      return /^DROP TABLE\b/i.test(line) || /\bDROP COLUMN\b/i.test(line);
    });
}

function readDriftSql() {
  return execFileSync(
    'pnpm',
    [
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--from-schema-datasource',
      SCHEMA_PATH,
      '--to-schema-datamodel',
      SCHEMA_PATH,
      '--script',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function selfCheck() {
  const sample = [
    '-- DropIndex',
    'DROP INDEX "idx_episodic_memory_embedding";',
    '',
    '-- AlterTable',
    'ALTER TABLE "preview_action" ADD COLUMN     "last_failed_at" TIMESTAMP(3),',
    'ADD COLUMN     "last_failure_reason" TEXT;',
    '',
    '-- DropTable',
    'DROP TABLE "schedule_item";',
  ].join('\n');

  const found = findDestructiveStatements(sample);
  assert.deepEqual(found, ['DROP TABLE "schedule_item";'], 'DROP TABLE 만 걸러야 한다');

  const dropColumn = findDestructiveStatements(
    'ALTER TABLE "preview_action" DROP COLUMN "last_failed_at";',
  );
  assert.equal(dropColumn.length, 1, 'DROP COLUMN 도 걸러야 한다');

  assert.deepEqual(
    findDestructiveStatements('-- DropIndex\nDROP INDEX "idx_agent_run_output_fts";'),
    [],
    'DROP INDEX 는 통과시켜야 한다',
  );

  console.log('db-push-guard self-check 통과');
}

function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  if (process.env[OVERRIDE_ENV] === '1') {
    console.warn(`${OVERRIDE_ENV}=1 — 파괴적 변경 확인을 건너뛴다.`);
    return;
  }

  let sql = '';
  try {
    sql = readDriftSql();
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    console.error('drift 를 확인할 수 없어 push 를 중단한다. DB 가 떠 있는지(pnpm db:up) 확인할 것.');
    if (detail) {
      console.error(detail);
    }
    process.exit(1);
  }

  const destructive = findDestructiveStatements(sql);
  if (destructive.length === 0) {
    return;
  }

  console.error('');
  console.error('db push 를 중단한다 — 이 스키마로 push 하면 아래가 지워진다.');
  console.error('');
  for (const statement of destructive) {
    console.error(`  ${statement}`);
  }
  console.error('');
  console.error('로컬 DB 는 worktree 전체가 공유한다. 이 브랜치의 schema.prisma 가 뒤처져');
  console.error('있으면 다른 브랜치가 추가한 컬럼을 지우게 되고, 그 브랜치에서 도는 앱이 죽는다.');
  console.error('');
  console.error('먼저 이 브랜치를 main 위로 리베이스할 것. 정말 지우려면:');
  console.error(`  ${OVERRIDE_ENV}=1 pnpm db:push`);
  console.error('');
  process.exit(1);
}

main();
