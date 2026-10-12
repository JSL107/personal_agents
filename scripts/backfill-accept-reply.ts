import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

// 일회성 백필: 목표 7(#669) 이전에 확정된 ACKED 카드의 owner 답글을 `accept_reply` 로 되돌린다.
// 선례는 `scripts/__backfill.ts`(기각 이유 백필) — 같은 dry-run / `--apply` 구조다.
//
// 추출 규칙은 운영 수확(`harvest-signal.ts` 의 `ownerReplyBody`)과 같다: 봇 코멘트와 같은
// 스레드에서, 봇 코멘트보다 늦게, owner 가 쓴, 봇 표식으로 시작하지 않는 글을 `\n` 으로 잇는다.
// 운영은 GraphQL(`reviewThreads(first:50)`·`comments(first:20)`)이라 긴 스레드가 잘리지만,
// 여기서는 REST `/pulls/{n}/comments` 를 끝까지 페이지네이션해 그 잘림이 없다.
//
// 🔴 대조군: 운영 코드가 이미 채운 카드에도 같은 추출을 돌려 바이트 일치를 센다. 불일치가 있으면
// 이 스크립트의 규칙이 운영과 갈린 것이니 `--apply` 하지 않는다.
//
//   pnpm exec ts-node scripts/backfill-accept-reply.ts            # 미리보기(변경 없음)
//   pnpm exec ts-node scripts/backfill-accept-reply.ts --apply    # 백업 후 accept_reply 만 갱신

const OWNER = 'JSL107';
const MARKER = '🤖 **이대리 자동 리뷰**';
// 운영 GraphQL 상한. 넘는 스레드에서 회수한 건수를 따로 센다(운영이 놓쳤을 몫).
const GRAPHQL_THREADS_MAX = 50;
const GRAPHQL_COMMENTS_MAX = 20;
const RATE_LIMIT_FLOOR = 200;
const APPLY = process.argv.includes('--apply');
const BACKUP_DIR = join(homedir(), '.idaeri-backups');

interface RestComment {
  id: number;
  in_reply_to_id: number | null;
  login: string | null;
  body: string;
  created_at: string;
}

type Miss =
  | 'NO_ACCESS'
  | 'FETCH_ERROR'
  | 'BOT_COMMENT_MISSING'
  | 'NON_OWNER_REPLY_ONLY'
  | 'REPLY_AFTER_DECISION_ONLY'
  | 'NO_REPLY';

type Extracted =
  | { kind: 'OK'; reply: string; beyondGraphqlLimit: boolean }
  | { kind: 'MISS'; reason: Miss; detail?: string };

const sameLogin = (left: string | null, right: string): boolean =>
  left !== null && left.trim().toLowerCase() === right.toLowerCase();

const waitForRateLimit = (): void => {
  const raw = execFileSync(
    'gh',
    [
      'api',
      'rate_limit',
      '--jq',
      '.resources.core | "\\(.remaining) \\(.reset)"',
    ],
    { encoding: 'utf-8' },
  );
  const [remaining, reset] = raw.trim().split(' ').map(Number);
  if (remaining >= RATE_LIMIT_FLOOR) {
    return;
  }
  const waitMs = Math.max(0, reset * 1000 - Date.now()) + 5_000;
  console.log(
    `  레이트리밋 잔여 ${remaining} — ${Math.ceil(waitMs / 1000)}초 대기`,
  );
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
};

const fetchComments = (
  repo: string,
  pullNumber: number,
): RestComment[] | Miss => {
  try {
    const raw = execFileSync(
      'gh',
      [
        'api',
        `repos/${repo}/pulls/${pullNumber}/comments?per_page=100`,
        '--paginate',
        '--jq',
        '.[] | {id, in_reply_to_id, login: .user.login, body, created_at}',
      ],
      {
        encoding: 'utf-8',
        maxBuffer: 100 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return raw
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as RestComment);
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? error);
    // GitHub 은 접근 권한이 없는 비공개 레포를 404 로 숨긴다 — 403 과 묶어 권한 부족으로 센다.
    const noAccess = /HTTP (403|404)/.test(stderr);
    console.log(
      `  ${repo}#${pullNumber} 조회 실패: ${stderr.trim().split('\n')[0]}`,
    );
    return noAccess ? 'NO_ACCESS' : 'FETCH_ERROR';
  }
};

const extractOwnerReply = (
  comments: RestComment[],
  botCommentId: number,
  decidedAt: Date | null,
): Extracted => {
  const bot = comments.find((comment) => comment.id === botCommentId);
  if (!bot) {
    return { kind: 'MISS', reason: 'BOT_COMMENT_MISSING' };
  }
  // REST 의 in_reply_to_id 는 스레드 첫 코멘트를 가리킨다 — 같은 뿌리를 가진 글이 한 스레드다.
  const rootOf = (comment: RestComment): number =>
    comment.in_reply_to_id ?? comment.id;
  const root = rootOf(bot);
  const thread = comments.filter((comment) => rootOf(comment) === root);
  const later = thread.filter(
    (comment) =>
      comment.created_at > bot.created_at && !comment.body.startsWith(MARKER),
  );
  const owned = later.filter((comment) => sameLogin(comment.login, OWNER));
  if (owned.length === 0) {
    return {
      kind: 'MISS',
      reason: later.length > 0 ? 'NON_OWNER_REPLY_ONLY' : 'NO_REPLY',
    };
  }
  // 운영은 카드가 확정되는 순간의 스레드를 저장한다. 그 뒤의 후속 답글(측정 결과, 결정 번복 등)까지
  // 이으면 운영과 다른 값이 되고, 번복된 스레드는 수용 재료에 반대 취지가 섞인다(카드 1461).
  const beforeDecision =
    decidedAt === null
      ? owned
      : owned.filter((comment) => new Date(comment.created_at) <= decidedAt);
  if (beforeDecision.length === 0) {
    const first = owned[0];
    const gapMinutes = Math.round(
      (new Date(first.created_at).getTime() - decidedAt!.getTime()) / 60_000,
    );
    return {
      kind: 'MISS',
      reason: 'REPLY_AFTER_DECISION_ONLY',
      detail: `확정 +${gapMinutes}분 ${first.body.replace(/\s+/g, ' ').slice(0, 60)}`,
    };
  }
  const threadCount = new Set(comments.map(rootOf)).size;
  return {
    kind: 'OK',
    reply: beforeDecision.map((comment) => comment.body).join('\n'),
    beyondGraphqlLimit:
      thread.length > GRAPHQL_COMMENTS_MAX || threadCount > GRAPHQL_THREADS_MAX,
  };
};

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const cards = await prisma.prReviewFinding.findMany({
    where: { status: 'ACKED', githubCommentId: { not: null } },
    select: {
      id: true,
      repo: true,
      pullNumber: true,
      githubCommentId: true,
      acceptReply: true,
      decidedAt: true,
    },
    orderBy: { id: 'asc' },
  });
  const groups = new Map<string, typeof cards>();
  for (const card of cards) {
    const key = `${card.repo}#${card.pullNumber}`;
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  const targetCount = cards.filter((card) => card.acceptReply === null).length;
  const undatedCount = cards.filter(
    (card) => card.acceptReply === null && card.decidedAt === null,
  ).length;
  console.log(
    `확정 시각(decided_at) 없는 대상 ${undatedCount}건 — 답글을 시각으로 자르지 못한다`,
  );
  console.log(
    `ACKED(코멘트 id 있음) ${cards.length}건 · 대상(accept_reply 비어 있음) ${targetCount}건 · PR ${groups.size}개\n`,
  );

  const updates: {
    id: number;
    repo: string;
    pullNumber: number;
    reply: string;
  }[] = [];
  const misses = new Map<
    Miss,
    { id: number; repo: string; pullNumber: number; detail?: string }[]
  >();
  const control = { match: 0, mismatch: [] as number[], miss: 0 };
  let beyondGraphqlLimit = 0;

  let index = 0;
  for (const [key, group] of groups) {
    index += 1;
    if (index % 20 === 1) {
      waitForRateLimit();
      console.log(`[${index}/${groups.size}] ${key}`);
    }
    const { repo, pullNumber } = group[0];
    const comments = fetchComments(repo, pullNumber);
    for (const card of group) {
      const result: Extracted =
        typeof comments === 'string'
          ? { kind: 'MISS', reason: comments }
          : extractOwnerReply(
              comments,
              Number(card.githubCommentId),
              card.decidedAt,
            );
      if (card.acceptReply !== null) {
        if (result.kind !== 'OK') {
          control.miss += 1;
        } else if (result.reply === card.acceptReply) {
          control.match += 1;
        } else {
          control.mismatch.push(card.id);
        }
        continue;
      }
      if (result.kind === 'MISS') {
        misses.set(result.reason, [
          ...(misses.get(result.reason) ?? []),
          { id: card.id, repo, pullNumber, detail: result.detail },
        ]);
        continue;
      }
      if (result.beyondGraphqlLimit) {
        beyondGraphqlLimit += 1;
      }
      updates.push({ id: card.id, repo, pullNumber, reply: result.reply });
    }
  }

  console.log('\n=== 결과 ===');
  console.log(
    `백필 가능 ${updates.length}건 (그중 운영 GraphQL 상한을 넘는 스레드 ${beyondGraphqlLimit}건)`,
  );
  console.log(`못 가져옴 ${targetCount - updates.length}건`);
  for (const [reason, rows] of misses) {
    const byRepo = new Map<string, number>();
    for (const row of rows) {
      byRepo.set(row.repo, (byRepo.get(row.repo) ?? 0) + 1);
    }
    console.log(
      `  ${reason} ${rows.length}건 — ${[...byRepo].map(([repo, count]) => `${repo} ${count}`).join(' · ')}`,
    );
    for (const row of rows) {
      console.log(
        `    카드 ${row.id} ${row.repo}#${row.pullNumber}${row.detail ? ` ${row.detail}` : ''}`,
      );
    }
  }
  console.log(
    `대조군(이미 채워진 카드) 일치 ${control.match} · 불일치 ${control.mismatch.length}${control.mismatch.length > 0 ? ` (카드 ${control.mismatch.join(',')})` : ''} · 추출 실패 ${control.miss}`,
  );
  for (const sample of updates.slice(0, 3)) {
    console.log(
      `\n예시 카드 ${sample.id} ${sample.repo}#${sample.pullNumber} (${sample.reply.length}자): ${sample.reply.replace(/\s+/g, ' ').slice(0, 120)}…`,
    );
  }

  if (!APPLY) {
    console.log('\ndry-run — 적용하려면 --apply');
    await prisma.$disconnect();
    return;
  }
  if (control.mismatch.length > 0 || control.miss > 0) {
    console.log(
      '\n대조군 불일치 — 추출 규칙이 운영과 갈렸으므로 적용하지 않는다.',
    );
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = join(
    BACKUP_DIR,
    `accept-reply-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  const before = await prisma.prReviewFinding.findMany({
    where: { id: { in: updates.map((update) => update.id) } },
  });
  writeFileSync(
    backupPath,
    JSON.stringify(
      before,
      (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      2,
    ),
  );
  console.log(`\n백업 ${before.length}행: ${backupPath}`);

  let written = 0;
  for (const { id, reply } of updates) {
    // 조건부 갱신: 그 사이 운영 수확이 채웠거나 상태가 바뀐 행은 덮어쓰지 않는다.
    const { count } = await prisma.prReviewFinding.updateMany({
      where: { id, status: 'ACKED', acceptReply: null },
      data: { acceptReply: reply },
    });
    written += count;
  }
  console.log(
    `${written}건 갱신 (건너뜀 ${updates.length - written}건 — 그 사이 채워졌거나 상태 변경)`,
  );
  await prisma.$disconnect();
}

void main();
