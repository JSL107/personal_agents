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
// `~/repos/JSL107.github.io`). 읽기만 하고 아무것도 바꾸지 않는다. 클론이 낡으면 최근 글이
// 통째로 빠지므로 **실행 전에 `git fetch && git merge --ff-only` 로 맞춰라** — 실제로 7커밋
// 뒤처진 클론으로 재서 최근 7편이 집계에서 빠진 적이 있다.
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

interface PublishedPost {
  path: string;
  title: string;
  publishedAt: Date;
  published: string;
  fromDeepdive: boolean;
}

const fetchPublished = async (since: string): Promise<PublishedPost[]> => {
  // 딥다이브가 만든 Notion 초안의 주소. 발행 카드와 이 집합을 맞춰 초안 경로를 가른다.
  const deepdiveRuns = await prisma.agentRun.findMany({
    where: { agentType: 'CTO_STUDY', status: 'SUCCEEDED' },
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
    posts.push({
      path: payload.path,
      title: typeof payload.title === 'string' ? payload.title : payload.path,
      publishedAt: preview.appliedAt,
      published: payload.content,
      fromDeepdive:
        typeof payload.notionUrl === 'string' &&
        deepdiveUrls.has(payload.notionUrl),
    });
  }
  return posts;
};

interface Row {
  title: string;
  publishedAt: Date;
  fromDeepdive: boolean;
  revisionPercent: number;
}

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
    const after = fileAsOf(post.path, asOf);
    if (after === null) {
      missing.push(post.path);
      continue;
    }
    rows.push({
      title: post.title,
      publishedAt: post.publishedAt,
      fromDeepdive: post.fromDeepdive,
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
        row.fromDeepdive ? '오늘의공부' : '그 외',
        row.title.slice(0, 40),
      ].join('\t'),
    );
  }

  const deepdive = rows.filter((row) => row.fromDeepdive);
  console.log(`\n${summarize('오늘의 공부', deepdive)}`);
  console.log(
    summarize(
      '그 외',
      rows.filter((row) => !row.fromDeepdive),
    ),
  );
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
