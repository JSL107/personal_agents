// 발행 후 **같은 경과일**에 사람이 얼마나 고쳤는지 잰다 — 프롬프트를 바꾼 전후를 비교하는 자리다.
//
// `blog-revision-report.ts` 와 무엇이 다른가: 그쪽은 저장소의 **현재 파일**과 비교한다. 그러면
// 오래된 글일수록 수정이 쌓여 높게 나오므로, 발행 시기가 다른 두 무리를 비교할 수 없다. 여기서는
// 발행일 + N일 시점의 파일을 꺼내 경과일을 통일한다.
//
// 두 짝:
//   발행본    승인된 발행 카드의 `payload.content` (사용자가 ✅ 눌러 실제로 커밋된 그대로)
//   N일 후 본  블로그 저장소에서 `발행일 + N일` 이전 마지막 커밋의 그 파일
//
// **출처를 `blog-revision-report.ts` 와 맞췄다.** 한쪽이 git 최초 커밋을 쓰고 다른 쪽이 발행
// 카드를 쓰면 같은 글에 다른 수정률이 나온다(실제로 그렇게 어긋난 기록이 있다). 발행 카드가
// 정본이다 — 파이프라인이 내보낸 본문이 그것이고, git 최초 커밋에는 커밋 단계에서 붙는 것이
// 섞일 수 있다.
//
// **초안 경로를 가른다.** '오늘의 공부'(딥다이브)와 회고는 생성 프롬프트가 다르므로 한 무리로
// 세면 안 된다. 발행 카드의 `notionUrl` 을 딥다이브 실행 기록(`CTO_STUDY`)의 `notionUrl` 과
// 맞춰 가른다. 제목으로 맞추면 안 된다 — 편집 단계에서 제목이 바뀌어 실측 22편 중 2편만 붙었다.
//
// 사용:
//   node --env-file=.env -r ts-node/register/transpile-only scripts/blog-revision-window.ts
//   node --env-file=.env -r ts-node/register/transpile-only scripts/blog-revision-window.ts --window 14 --since 2026-08-01
//
// `DATABASE_URL` 과 블로그 저장소 로컬 클론이 필요하다(`BLOG_LOCAL_PATH`, 기본
// `~/repos/JSL107.github.io`). 읽기만 하고 아무것도 바꾸지 않는다.
//
// **실행 전에 클론을 `git fetch && git merge --ff-only` 로 맞춰라.** 낡은 클론은 두 가지로
// 망가뜨린다 — 없는 글이 빠지는 것(실제로 7커밋 뒤처진 클론에서 7편이 빠졌다)은 눈에 띄지만,
// 이미 있는 글에 「발행 직후 커밋」을 N일 후 본으로 돌려주는 쪽은 정상 행으로 집계돼 보이지
// 않는다. 후자는 `headCommittedAt` 가드가 막는다.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { countRevision } from '../src/agent/blog/domain/revision-rate';

const prisma = new PrismaClient();

// (Nest DI 컨텍스트 밖의 스크립트라 `process.env` 직접 접근이 허용된다 — CODE_RULES §9)
const REPOSITORY_PATH =
  process.env.BLOG_LOCAL_PATH ?? join(homedir(), 'repos', 'JSL107.github.io');

const DEFAULT_WINDOW_DAYS = 9;

interface Options {
  windowDays: number;
  since: string;
}

const parseOptions = (argv: readonly string[]): Options => {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const rawWindow = valueOf('--window');
  const windowDays =
    rawWindow === undefined ? DEFAULT_WINDOW_DAYS : Number(rawWindow);
  if (!Number.isInteger(windowDays) || windowDays <= 0) {
    throw new Error(`--window 는 양의 정수여야 한다: ${String(rawWindow)}`);
  }
  return { windowDays, since: valueOf('--since') ?? '2026-08-01' };
};

const git = (args: readonly string[]): string =>
  execFileSync(
    'git',
    ['-C', REPOSITORY_PATH, '-c', 'core.quotepath=false', ...args],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  ).trim();

/**
 * 클론이 아는 마지막 커밋 시각.
 *
 * **이 값보다 뒤의 `asOf` 는 잴 수 없다.** `git log --until` 은 조건에 맞는 마지막 커밋을
 * 돌려주므로, 클론이 낡으면 「발행 직후 커밋」을 「N일 후 본」이라고 내놓는다. 파일은 존재하니
 * `missing` 으로도 걸러지지 않고 정상 행으로 집계되며, 수정률이 조용히 0% 쪽으로 쏠린다.
 * 그 편향은 「고칠 게 없었다」는 쪽이라 프롬프트 변경을 지지하는 방향으로 기운다 — 조용히
 * 틀리는 값이 가장 위험하므로 재지 않고 멈춘다(리뷰 지적).
 */
const headCommittedAt = (): Date =>
  new Date(git(['log', '-1', '--format=%cI']));

/** 발행일 + N일 시점의 파일. 그 시점에 파일이 없으면 null. */
const fileAsOf = (path: string, asOf: Date): string | null => {
  const sha = git([
    'log',
    '-1',
    `--until=${asOf.toISOString()}`,
    '--format=%H',
    '--',
    path,
  ]);
  if (sha === '') {
    return null;
  }
  try {
    return git(['show', `${sha}:${path}`]);
  } catch {
    return null;
  }
};

/** 초안 경로. `unknown` 은 카드에 `notionUrl` 이 없어 가를 수 없는 것이다. */
type DraftSource = 'deepdive' | 'other' | 'unknown';

interface PublishedPost {
  path: string;
  title: string;
  publishedAt: Date;
  published: string;
  source: DraftSource;
}

// 초안은 발행보다 **먼저** 만들어진다. 굶은 초안은 14일까지 큐에 머물 수 있고 그보다 오래
// 묵기도 하므로, 딥다이브 실행을 `since` 로 그대로 자르면 그 앞에 만들어진 초안이 집합에서
// 빠져 멀쩡한 글이 '그 외'로 오분류된다. 넉넉한 여유를 두고 자른다(리뷰 지적의 방향은 받되
// 제안된 경계는 쓰지 않는다).
const DRAFT_LOOKBACK_DAYS = 90;

const fetchPublished = async (since: string): Promise<PublishedPost[]> => {
  // 딥다이브가 만든 Notion 초안의 주소. 발행 카드와 이 집합을 맞춰 초안 경로를 가른다.
  const draftSince = new Date(
    new Date(since).getTime() - DRAFT_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000,
  );
  const deepdiveRuns = await prisma.agentRun.findMany({
    where: {
      agentType: 'CTO_STUDY',
      status: 'SUCCEEDED',
      startedAt: { gte: draftSince },
    },
    select: { output: true },
  });
  const deepdiveUrls = new Set<string>();
  for (const run of deepdiveRuns) {
    const url = (run.output as { notionUrl?: unknown } | null)?.notionUrl;
    if (typeof url === 'string' && url !== '') {
      deepdiveUrls.add(url);
    }
  }

  const previews = await prisma.previewAction.findMany({
    where: {
      kind: 'BLOG_GITHUB_PUBLISH',
      status: 'APPLIED',
      appliedAt: { gte: new Date(since) },
    },
    select: { payload: true, appliedAt: true },
    orderBy: { appliedAt: 'asc' },
  });

  const posts: PublishedPost[] = [];
  for (const preview of previews) {
    const payload = preview.payload as {
      path?: unknown;
      content?: unknown;
      title?: unknown;
      notionUrl?: unknown;
    } | null;
    if (
      typeof payload?.path !== 'string' ||
      typeof payload.content !== 'string' ||
      preview.appliedAt === null
    ) {
      // 이 필드가 없던 시절의 카드. 짝을 못 맞추므로 뺀다.
      continue;
    }
    // `notionUrl` 이 없으면 '그 외'로 떨어뜨리지 않고 따로 센다. 데이터 결손을 대조군에 섞으면
    // 그 오염이 숫자에 조용히 남는다 — 위 `path`·`content` 결손을 명시적으로 빼는 것과 같은
    // 이유다(리뷰 지적).
    const source: DraftSource =
      typeof payload.notionUrl !== 'string'
        ? 'unknown'
        : deepdiveUrls.has(payload.notionUrl)
          ? 'deepdive'
          : 'other';
    posts.push({
      path: payload.path,
      title: typeof payload.title === 'string' ? payload.title : payload.path,
      publishedAt: preview.appliedAt,
      published: payload.content,
      source,
    });
  }
  return posts;
};

interface Row {
  title: string;
  publishedAt: Date;
  source: DraftSource;
  revisionPercent: number;
}

const SOURCE_LABEL: Record<DraftSource, string> = {
  deepdive: '오늘의공부',
  other: '그 외',
  unknown: '분류불명',
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const summarize = (label: string, rows: readonly Row[]): string => {
  const percents = rows.map((row) => row.revisionPercent);
  return `${label}: ${rows.length}편 · 중앙값 ${median(percents)}% · 평균 ${
    rows.length === 0
      ? 'NaN'
      : Math.round(
          percents.reduce((sum, value) => sum + value, 0) / rows.length,
        )
  }%`;
};

const main = async (): Promise<void> => {
  const { windowDays, since } = parseOptions(process.argv.slice(2));
  const posts = await fetchPublished(since);
  const nowMs = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1_000;
  const headAtMs = headCommittedAt().getTime();

  const rows: Row[] = [];
  const tooYoung: string[] = [];
  const missing: string[] = [];

  for (const post of posts) {
    const asOf = new Date(post.publishedAt.getTime() + windowMs);
    if (asOf.getTime() > nowMs) {
      // 아직 창이 안 찼다. 덜 익은 글을 섞으면 그 글만 낮게 나와 비교가 망가진다.
      tooYoung.push(post.title);
      continue;
    }
    if (asOf.getTime() > headAtMs) {
      throw new Error(
        [
          `클론이 낡아서 잴 수 없다: "${post.title}" 의 기준 시각은 ${asOf.toISOString()} 인데`,
          `클론의 마지막 커밋은 ${new Date(headAtMs).toISOString()} 이다.`,
          `${REPOSITORY_PATH} 에서 git fetch && git merge --ff-only 로 맞춘 뒤 다시 실행하라.`,
        ].join('\n'),
      );
    }
    const after = fileAsOf(post.path, asOf);
    if (after === null) {
      missing.push(post.path);
      continue;
    }
    rows.push({
      title: post.title,
      publishedAt: post.publishedAt,
      source: post.source,
      // 서버·다른 스크립트와 **같은 도메인 함수**를 쓴다. 각자 계산하면 같은 글에 다른 값이 찍힌다.
      revisionPercent: countRevision(post.published, after).percent,
    });
  }

  console.log(`경과일 ${windowDays}일 통일 · ${since} 이후 발행분\n`);
  console.log('발행일\t수정률\t경로\t글');
  for (const row of rows) {
    console.log(
      [
        row.publishedAt.toISOString().slice(0, 10),
        `${row.revisionPercent}%`,
        SOURCE_LABEL[row.source],
        row.title.slice(0, 40),
      ].join('\t'),
    );
  }

  const bySource = (source: DraftSource): Row[] =>
    rows.filter((row) => row.source === source);
  console.log(`\n${summarize('오늘의 공부', bySource('deepdive'))}`);
  console.log(summarize('그 외', bySource('other')));
  const unknown = bySource('unknown');
  if (unknown.length > 0) {
    // 0 건이면 줄을 내지 않는다 — 늘 붙는 「0편」은 옆의 실제 수치를 덮는다.
    console.log(summarize('분류불명(notionUrl 없음)', unknown));
  }
  console.log(summarize('전체', rows));

  if (tooYoung.length > 0) {
    console.log(`\n창 미달(${windowDays}일 안 지남) ${tooYoung.length}편`);
  }
  if (missing.length > 0) {
    console.log(
      `저장소에서 못 찾음 ${missing.length}편: ${missing.join(', ')}`,
    );
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
