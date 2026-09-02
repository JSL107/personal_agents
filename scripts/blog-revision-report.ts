// 발행한 글을 사람이 얼마나 고쳤는지 잰다 — 지금 파이프라인에서 **글의 품질을 판정하는 유일한
// 자리**다.
//
// 발행 경로의 다른 판정은 전부 하한선이거나 훼손 방지다. 편집 단계(`blog-edit.prompt.ts`)는
// 「필기인가 · 주제가 있나 · 800자 넘나 · 틀렸나」만 보고, 문체 지표는 카드에 숫자를 적을 뿐
// 발행을 막지 않는다. 좋은 글과 그저 그런 글을 가르는 자리가 없다.
//
// 그 자리를 사람이 이미 메우고 있었다 — 발행된 글을 다시 열어 고친다. 고친 양이 곧 판정이다.
// 많이 고쳤으면 그만큼 안 좋았던 것이고, 손댈 데가 없으면 좋았던 것이다. 이 스크립트는 그
// 판정을 숫자로 꺼내 온다.
//
// 두 짝을 맞춘다:
//   발행본  실행 원장 `agent_run.output.content` (모델이 만들어 커밋한 그대로)
//   최종본  블로그 저장소의 현재 파일 (사람이 고친 뒤)
//
// 사용 (.env 로딩은 Node 22 내장 --env-file 사용 — dotenv 파서 직접 구현 X):
//   node --env-file=.env -r ts-node/register/transpile-only scripts/blog-revision-report.ts
//
// `gh` CLI 인증과 DATABASE_URL 이 필요하다. 읽기만 하고 아무것도 바꾸지 않는다.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

import {
  KoreanStyleMetrics,
  measureKoreanStyle,
} from '../src/humanize/domain/korean-style-metrics';

const prisma = new PrismaClient();

const REPOSITORY = process.env.BLOG_PUBLISH_REPO ?? 'JSL107/JSL107.github.io';

interface PublishedPost {
  path: string;
  publishedAt: Date;
  published: string;
}

interface RevisionRow {
  path: string;
  publishedAt: Date;
  changedLines: number;
  totalLines: number;
  revisionPercent: number;
  publishedMetrics: KoreanStyleMetrics;
  finalMetrics: KoreanStyleMetrics;
}

const fetchPublished = async (): Promise<PublishedPost[]> => {
  const runs = await prisma.agentRun.findMany({
    where: { agentType: 'BLOG_PUBLISH', status: 'SUCCEEDED' },
    select: { output: true, startedAt: true },
    orderBy: { startedAt: 'asc' },
  });
  const posts: PublishedPost[] = [];
  for (const run of runs) {
    const output = run.output as { path?: unknown; content?: unknown } | null;
    if (
      typeof output?.path !== 'string' ||
      typeof output.content !== 'string'
    ) {
      // 원장에는 이 필드가 없던 시절의 회차가 섞여 있다. 그 회차는 짝을 못 맞추므로 뺀다.
      continue;
    }
    posts.push({
      path: output.path,
      publishedAt: run.startedAt,
      published: output.content,
    });
  }
  return posts;
};

const fetchFinal = (path: string): string | null => {
  try {
    const base64 = execFileSync(
      'gh',
      ['api', `repos/${REPOSITORY}/contents/${path}`, '--jq', '.content'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    ).trim();
    return Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    // 파일이 지워졌거나 경로가 바뀐 글. 없는 것은 없는 대로 두고 나머지를 센다.
    return null;
  }
};

/**
 * 두 판의 차이를 줄 수로 잰다.
 *
 * `git diff --numstat` 을 쓰는 이유는 이미 있는 도구이기 때문이고, `--no-index` 라 저장소
 * 바깥의 임시 파일에도 쓸 수 있다. 바뀐 줄은 추가 + 삭제다 — 한 줄을 고치면 양쪽에 1씩 잡히니
 * 실제 손댄 양보다 크게 나오지만, 회차끼리 비교하는 데는 같은 기준이면 충분하다.
 */
const countChangedLines = (
  directory: string,
  published: string,
  final: string,
): number => {
  const publishedPath = join(directory, 'published.md');
  const finalPath = join(directory, 'final.md');
  writeFileSync(publishedPath, published);
  writeFileSync(finalPath, final);
  try {
    execFileSync(
      'git',
      ['diff', '--no-index', '--numstat', publishedPath, finalPath],
      { encoding: 'utf8' },
    );
    // 차이가 없으면 exit 0 에 빈 출력이다.
    return 0;
  } catch (error: unknown) {
    // 차이가 있으면 git 이 exit 1 로 끝낸다 — 실패가 아니라 「다르다」는 뜻이다.
    const stdout = (error as { stdout?: string }).stdout ?? '';
    const [added, deleted] = stdout.trim().split('\t');
    return Number(added ?? 0) + Number(deleted ?? 0);
  }
};

const formatMetricShift = (row: RevisionRow): string => {
  const before = row.publishedMetrics;
  const after = row.finalMetrics;
  const shift = (label: string, from: number, to: number): string =>
    from === to ? `${label} ${from}` : `${label} ${from}→${to}`;
  return [
    shift('평균', before.averageLength, after.averageLength),
    shift('어절', before.wordsPerSentence, after.wordsPerSentence),
    shift(
      '편차',
      before.lengthStandardDeviation,
      after.lengthStandardDeviation,
    ),
    shift(
      '교대',
      before.endingAlternationPercent,
      after.endingAlternationPercent,
    ),
  ].join(' · ');
};

const main = async (): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), 'blog-revision-'));
  const posts = await fetchPublished();
  const rows: RevisionRow[] = [];
  const missing: string[] = [];

  for (const post of posts) {
    const final = fetchFinal(post.path);
    if (final === null) {
      missing.push(post.path);
      continue;
    }
    const changedLines = countChangedLines(directory, post.published, final);
    const totalLines = post.published.split('\n').length;
    rows.push({
      path: post.path,
      publishedAt: post.publishedAt,
      changedLines,
      totalLines,
      revisionPercent: Math.round((changedLines / totalLines) * 100),
      publishedMetrics: measureKoreanStyle(post.published),
      finalMetrics: measureKoreanStyle(final),
    });
  }

  console.log('발행일       수정률  바뀐줄/전체   글');
  for (const row of rows) {
    const date = row.publishedAt.toISOString().slice(0, 10);
    const percent = `${row.revisionPercent}%`.padStart(5);
    const lines = `${row.changedLines}/${row.totalLines}`.padStart(10);
    const name = row.path.replace(/^.*\//, '').replace(/\.md$/, '');
    console.log(`${date}  ${percent}  ${lines}   ${name}`);
    console.log(`                              ${formatMetricShift(row)}`);
  }

  if (rows.length > 0) {
    const average = Math.round(
      rows.reduce((sum, row) => sum + row.revisionPercent, 0) / rows.length,
    );
    // 손댈 데가 없는 글이 나오는 것이 목표다. 평균이 내려가면 그만큼 나아진 것이다.
    console.log(`\n글 ${rows.length}편 · 평균 수정률 ${average}%`);
  }
  if (missing.length > 0) {
    console.log(`짝을 못 찾은 글 ${missing.length}편: ${missing.join(', ')}`);
  }
};

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
