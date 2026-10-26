/**
 * 위험 지도 점수가 "머지 뒤 문제 있었던 PR" 을 얼마나 가르는지 리포트한다. 가중치는 바꾸지 않는다 —
 * 리포트를 보고 사람이 `risk-map.ts` 의 상수를 고친다.
 * 입력은 운영과 같은 GitHub 클라이언트(getPullRequest·getPullRequestDiff)로 받아 같은 computeRiskMap 에 넣는다.
 * 레포마다 머지 PR 이 가장 많은 base 하나만 본다 — dev·master 짝 PR 이 같은 변경을 두 번 세지 않게.
 * 머지 뒤 --window 일이 안 지난 PR 은 관찰이 덜 끝나 표본에서 빼고, 앞선 PR 의 라벨 근거로만 쓴다.
 * 회사 저장소의 PR 정보가 담기므로 리포트는 저장소 밖에 둔다(stdout 으로 낸다).
 *
 * 이대리 운영과 같은 토큰을 쓰므로 레포마다 남은 호출을 보고 RATE_LIMIT_RESERVE 만큼 남긴 채 표본을 줄인다.
 * --dump 로 받은 원자료를 저장해 두면, 상수를 고친 뒤 --from 으로 GitHub 호출 없이 다시 채점한다.
 *
 * pnpm review:calibrate [--repos owner/a,owner/b] [--months 6] [--window 14] [--max-per-repo 300]
 *   [--dump raw.json | --from raw.json] > report.md
 * --repos 를 빼면 PR_REVIEW_INLINE_REPOS 를 쓴다.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Octokit } from '@octokit/rest';

import {
  calibrate,
  collectSignals,
  labelPullRequests,
} from '../src/agent/code-reviewer/domain/risk-calibration';
import {
  CalibrationPoint,
  CalibrationReport,
  MergedPullRequest,
} from '../src/agent/code-reviewer/domain/risk-calibration.type';
import {
  CAREFUL_SCORE,
  computeRiskMap,
  QUICK_SCORE,
} from '../src/agent/code-reviewer/domain/risk-map';
import { RiskMapLevel } from '../src/agent/code-reviewer/domain/risk-map.type';
import {
  PullRequestDetail,
  PullRequestDiff,
} from '../src/github/domain/github.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
  OCTOKIT_INSTANCE,
} from '../src/github/domain/port/github-client.port';
import { GithubModule } from '../src/github/github.module';

const DAY_MS = 24 * 3600 * 1000;
const MONTH_DAYS = 30;
const CONCURRENCY = 4;
const BAD_LIST_MAX = 40;
// 이대리 운영이 같은 토큰을 쓴다 — 이만큼은 남기고 표본을 줄인다.
const RATE_LIMIT_RESERVE = 1500;
// PR 하나에 드는 호출 수(상세·파일 목록·diff). 파일 100개를 넘으면 목록 페이지가 늘지만 2026-10-26 실측 평균이
// 3.0회라, 그런 PR 의 초과분은 RATE_LIMIT_RESERVE 가 흡수한다.
const CALLS_PER_PULL_REQUEST = 3;

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), GithubModule],
})
class RiskCalibrateModule {}

interface CalibrateOptions {
  repos: string[] | undefined;
  months: number;
  windowDays: number;
  maxPerRepo: number;
  dump: string | undefined;
  from: string | undefined;
}

interface ListedPullRequest {
  number: number;
  title: string;
  mergedAt: string;
  base: string;
}

interface DumpedPullRequest {
  number: number;
  title: string;
  mergedAt: string;
  detail: PullRequestDetail;
  // 관찰 창이 덜 찬 PR 은 라벨 근거로만 쓰므로 diff 를 받지 않는다.
  diff: PullRequestDiff | null;
}

interface RepoDump {
  repo: string;
  base: string;
  merged: number;
  pullRequests: DumpedPullRequest[];
}

interface CalibrationDump {
  fetchedAt: string;
  months: number;
  windowDays: number;
  repos: RepoDump[];
}

interface RepoSample {
  repo: string;
  base: string;
  merged: number;
  fetched: number;
  points: CalibrationPoint[];
}

const main = async (): Promise<void> => {
  const options = readOptions();
  const dump =
    options.from === undefined
      ? await fetchDump(options)
      : (JSON.parse(readFileSync(options.from, 'utf8')) as CalibrationDump);
  if (options.dump !== undefined) {
    writeFileSync(options.dump, JSON.stringify(dump));
    progress(`원자료 저장: ${options.dump}`);
  }
  const samples = dump.repos.map((repoDump) => scoreRepo({ repoDump, dump }));
  process.stdout.write(renderReport({ samples, dump }));
};

const fetchDump = async (
  options: CalibrateOptions,
): Promise<CalibrationDump> => {
  const application = await NestFactory.createApplicationContext(
    RiskCalibrateModule,
    { logger: ['error', 'warn'] },
  );
  try {
    const octokit = application.get<Octokit | null>(OCTOKIT_INSTANCE, {
      strict: false,
    });
    if (octokit === null) {
      throw new Error('GITHUB_TOKEN 이 없습니다.');
    }
    const github = application.get<GithubClientPort>(GITHUB_CLIENT_PORT);
    const repos =
      options.repos ??
      parseRepos(application.get(ConfigService).get('PR_REVIEW_INLINE_REPOS'));
    if (repos.length === 0) {
      throw new Error(
        '대상 레포가 없습니다 — --repos 또는 PR_REVIEW_INLINE_REPOS.',
      );
    }
    const fetchedAt = new Date().toISOString();
    const repoDumps: RepoDump[] = [];
    for (const repo of repos) {
      repoDumps.push(
        await fetchRepo({ octokit, github, repo, options, fetchedAt }),
      );
    }
    return {
      fetchedAt,
      months: options.months,
      windowDays: options.windowDays,
      repos: repoDumps,
    };
  } finally {
    await application.close();
  }
};

const fetchRepo = async ({
  octokit,
  github,
  repo,
  options,
  fetchedAt,
}: {
  octokit: Octokit;
  github: GithubClientPort;
  repo: string;
  options: CalibrateOptions;
  fetchedAt: string;
}): Promise<RepoDump> => {
  const now = Date.parse(fetchedAt);
  const since = now - options.months * MONTH_DAYS * DAY_MS;
  const observedUntil = now - options.windowDays * DAY_MS;
  const budget = await pullRequestBudget(octokit);
  if (budget === 0) {
    progress(`${repo}: 호출 여유가 없어 건너뜀 (예약 ${RATE_LIMIT_RESERVE}회)`);
    return { repo, base: '', merged: 0, pullRequests: [] };
  }
  const listed = await listMergedSince({ octokit, repo, since });
  const base = mostCommonBase(listed);
  const onBase = listed
    .filter((pullRequest) => pullRequest.base === base)
    .sort(
      (left, right) => Date.parse(right.mergedAt) - Date.parse(left.mergedAt),
    );
  // 상한은 관찰이 끝난 PR 에만 건다 — 최근 N건으로 자르면 머지가 잦은 레포는 전부 관찰 중이라 표본이 0이 된다.
  // 관찰 중인 PR 은 앞선 표본의 라벨 근거라 함께 받는다.
  const watching = onBase.filter(
    (pullRequest) => Date.parse(pullRequest.mergedAt) > observedUntil,
  );
  const observed = onBase.filter(
    (pullRequest) => Date.parse(pullRequest.mergedAt) <= observedUntil,
  );
  const sampled = observed.slice(
    0,
    Math.min(options.maxPerRepo, budget - watching.length),
  );
  if (sampled.length === 0) {
    progress(
      `${repo}: 관찰 중 ${watching.length}건을 받으면 표본에 쓸 호출 여유가 없어 건너뜀 (여유 ${budget}건)`,
    );
    return { repo, base, merged: onBase.length, pullRequests: [] };
  }
  const picked = [...watching, ...sampled];
  progress(
    `${repo}: 머지 ${listed.length}건 중 base ${base} ${onBase.length}건 → 표본 ${sampled.length}건 + 관찰 중 ${watching.length}건 (호출 여유 ${budget}건)`,
  );
  const pullRequests = await mapLimited(
    picked,
    async (pullRequest): Promise<DumpedPullRequest> => {
      const ref = { repo, number: pullRequest.number };
      const detail = await github.getPullRequest(ref);
      const diff = watching.includes(pullRequest)
        ? null
        : await github.getPullRequestDiff(ref);
      return {
        number: pullRequest.number,
        title: pullRequest.title,
        mergedAt: pullRequest.mergedAt,
        detail,
        diff,
      };
    },
  );
  return { repo, base, merged: onBase.length, pullRequests };
};

const pullRequestBudget = async (octokit: Octokit): Promise<number> => {
  const { data } = await octokit.rest.rateLimit.get();
  const spare = data.resources.core.remaining - RATE_LIMIT_RESERVE;
  return Math.max(0, Math.floor(spare / CALLS_PER_PULL_REQUEST));
};

const scoreRepo = ({
  repoDump,
  dump,
}: {
  repoDump: RepoDump;
  dump: CalibrationDump;
}): RepoSample => {
  const labels = labelPullRequests({
    pullRequests: repoDump.pullRequests.map(
      (pullRequest): MergedPullRequest => ({
        number: pullRequest.number,
        title: pullRequest.title,
        mergedAt: pullRequest.mergedAt,
        files: pullRequest.detail.changedFiles,
      }),
    ),
    windowDays: dump.windowDays,
  });
  const points = repoDump.pullRequests.flatMap(
    ({ number, detail, diff }): CalibrationPoint[] => {
      if (diff === null) {
        return [];
      }
      const map = computeRiskMap({ detail, diff, findings: [] });
      const label = labels.get(number) ?? { bad: false, reason: null };
      return [
        {
          repo: repoDump.repo,
          number,
          score: map.score,
          level: map.level,
          signals: collectSignals({
            files: detail.changedFiles,
            removedFiles: removedFilesOf(detail),
            changedLines: totalLinesOf(detail),
            diff: diff.diff,
          }),
          bad: label.bad,
          reason: label.reason,
        },
      ];
    },
  );
  return {
    repo: repoDump.repo,
    base: repoDump.base,
    merged: repoDump.merged,
    fetched: repoDump.pullRequests.length,
    points,
  };
};

// updated 역순으로 받다가 since 보다 오래 전에 갱신된 PR 이 나오면 멈춘다 — 머지 시각은 갱신 시각 이하다.
const listMergedSince = async ({
  octokit,
  repo,
  since,
}: {
  octokit: Octokit;
  repo: string;
  since: number;
}): Promise<ListedPullRequest[]> => {
  const [owner, name] = repo.split('/');
  const listed: ListedPullRequest[] = [];
  const pages = octokit.paginate.iterator(octokit.rest.pulls.list, {
    owner,
    repo: name,
    state: 'closed',
    sort: 'updated',
    direction: 'desc',
    per_page: 100,
  });
  for await (const page of pages) {
    const pageItems = page.data;
    listed.push(
      ...pageItems.flatMap((item): ListedPullRequest[] =>
        item.merged_at !== null && Date.parse(item.merged_at) >= since
          ? [
              {
                number: item.number,
                title: item.title,
                mergedAt: item.merged_at,
                base: item.base.ref,
              },
            ]
          : [],
      ),
    );
    const oldest = pageItems.at(-1);
    if (oldest === undefined || Date.parse(oldest.updated_at) < since) {
      break;
    }
  }
  return listed;
};

const mostCommonBase = (listed: readonly ListedPullRequest[]): string => {
  const counts = new Map<string, number>();
  for (const { base } of listed) {
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const [top] = [...counts].sort((left, right) => right[1] - left[1]);
  return top?.[0] ?? '';
};

const removedFilesOf = (detail: PullRequestDetail): string[] =>
  Object.entries(detail.changedFileStatsByFile ?? {})
    .filter(([, stat]) => stat.status === 'removed')
    .map(([path]) => path);

const totalLinesOf = (detail: PullRequestDetail): number =>
  Object.values(detail.changedLinesByFile).reduce(
    (sum, lines) => sum + lines,
    0,
  );

const mapLimited = async <Item, Result>(
  items: readonly Item[],
  work: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
  const chunks = Array.from(
    { length: Math.ceil(items.length / CONCURRENCY) },
    (_, index) => items.slice(index * CONCURRENCY, (index + 1) * CONCURRENCY),
  );
  const results: Result[] = [];
  for (const chunk of chunks) {
    results.push(...(await Promise.all(chunk.map(work))));
  }
  return results;
};

const renderReport = ({
  samples,
  dump,
}: {
  samples: RepoSample[];
  dump: CalibrationDump;
}): string => {
  const points = samples.flatMap((sample) => sample.points);
  const report = calibrate(points);
  const bads = points
    .filter((point) => point.bad)
    .sort((left, right) => right.score - left.score);
  return [
    '# 위험 지도 보정 리포트',
    '',
    `- 수집: ${dump.fetchedAt} · 최근 ${dump.months}개월 머지 · 문제 판정 창 ${dump.windowDays}일`,
    `- 현재 임계값: quick ${QUICK_SCORE} · careful ${CAREFUL_SCORE}`,
    '',
    '## 레포별',
    '',
    '| 레포 | base | 머지 | 수집 | 표본 | 문제 | 비율 | AUC |',
    '|---|---|---|---|---|---|---|---|',
    ...samples.map((sample) => {
      const own = calibrate(sample.points);
      return `| ${sample.repo} | ${sample.base} | ${sample.merged} | ${sample.fetched} | ${own.total} | ${own.bad} | ${own.baseRate} | ${own.auc ?? '-'} |`;
    }),
    '',
    ...renderSummary(report),
    '',
    `## 문제 PR (점수 순, 최대 ${BAD_LIST_MAX}건)`,
    '',
    '| PR | 점수 | 등급 | 신호 | 근거 |',
    '|---|---|---|---|---|',
    ...bads
      .slice(0, BAD_LIST_MAX)
      .map(
        (point) =>
          `| ${point.repo}#${point.number} | ${point.score} | ${point.level} | ${point.signals.join(' ') || '-'} | ${escapeCell(point.reason ?? '')} |`,
      ),
    '',
  ].join('\n');
};

const renderSummary = (report: CalibrationReport): string[] => [
  '## 전체',
  '',
  `- 표본 ${report.total}건 · 문제 ${report.bad}건 · 기준 비율 ${report.baseRate}`,
  `- AUC ${report.auc ?? '-'} (0.5 = 가르지 못함, 1 = 완벽)`,
  `- 임계값 제안: quick ${report.suggested.quick ?? '-'} · careful ${report.suggested.careful ?? '-'}`,
  '',
  '### 등급별',
  '',
  '| 등급 | 표본 | 문제 | 비율 |',
  '|---|---|---|---|',
  ...Object.values(RiskMapLevel).map((level) => {
    const cell = report.byLevel[level];
    return `| ${level} | ${cell.n} | ${cell.bad} | ${cell.rate} |`;
  }),
  '',
  '### 점수 구간별',
  '',
  '| 구간 | 표본 | 문제 | 비율 |',
  '|---|---|---|---|',
  ...report.byScore.map(
    (cell) => `| ${cell.range} | ${cell.n} | ${cell.bad} | ${cell.rate} |`,
  ),
  '',
  '### 신호별 (있음 vs 없음)',
  '',
  '| 신호 | 있음 표본 | 있음 비율 | 없음 표본 | 없음 비율 |',
  '|---|---|---|---|---|',
  ...report.bySignal.map(
    (cell) =>
      `| ${cell.signal} | ${cell.with.n} | ${cell.with.rate} | ${cell.without.n} | ${cell.without.rate} |`,
  ),
];

const escapeCell = (text: string): string => text.replace(/\|/g, '\\|');

const parseRepos = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const progress = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const readOptions = (): CalibrateOptions => {
  const repos = readOption('repos');
  return {
    repos: repos === undefined ? undefined : parseRepos(repos),
    months: readPositiveInteger('months', 6),
    windowDays: readPositiveInteger('window', 14),
    maxPerRepo: readPositiveInteger('max-per-repo', 300),
    dump: readOption('dump'),
    from: readOption('from'),
  };
};

const readPositiveInteger = (name: string, fallback: number): number => {
  const value = readOption(name);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} 는 양의 정수여야 합니다: ${value}`);
  }
  return parsed;
};

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--') || value.trim() === '') {
    throw new Error(`--${name} 값이 없습니다.`);
  }
  return value;
};

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
