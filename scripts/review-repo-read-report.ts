import { Prisma, PrismaClient } from '@prisma/client';

import { TriggerType } from '../src/agent-run/domain/agent-run.type';
import { AgentType } from '../src/model-router/domain/model-router.type';
import {
  RepoReadReport,
  RepoReadRunRow,
  summarizeRepoRead,
} from '../src/pr-review-loop/domain/repo-read-report';

// 레포 사본 리뷰(PR_REVIEW_REPO_READ_REPOS)의 운영 지표를 레포별로 출력한다. 읽기만 한다.
// 최근 N일(현재 구간)과 그 직전 N일을 비교한다 — 켠 뒤 2주가 지나면 `--days 14` 로 판정한다.
// 판정 기준은 docs/superpowers/specs/2026-10-29-review-repo-read-stage2-design.md §7.

const DEFAULT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE = '사용법: pnpm review:repo-read-report [--days N]';

const readDays = (argv: readonly string[]): number => {
  const index = argv.indexOf('--days');
  if (index === -1) {
    return DEFAULT_DAYS;
  }
  const days = Number(argv[index + 1]);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(USAGE);
  }
  return days;
};

// input_snapshot 은 Prisma Json 이다. 객체가 아니면(배열·스칼라·null) 값이 없는 것으로 본다.
const snapshotField = (
  snapshot: Prisma.JsonValue,
  key: string,
): string | undefined => {
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot)
  ) {
    return undefined;
  }
  const value = snapshot[key];
  return typeof value === 'string' ? value : undefined;
};

const formatSeconds = (milliseconds: number | null): string =>
  milliseconds === null ? '-' : `${Math.round(milliseconds / 1000)}초`;

const formatRate = (rate: number | null, total: number): string =>
  rate === null ? `표본 부족(${total}장)` : `${rate}% (${total}장)`;

const render = (report: RepoReadReport): string =>
  [
    `## ${report.repo}`,
    `- 사본 상태: ${JSON.stringify(report.repoReadCounts)}`,
    `- 후퇴 사유: ${JSON.stringify(report.fallbackReasonCounts)}`,
    `- USED 소요 중앙값: ${formatSeconds(report.usedMedianMs)} / 최대(전체): ${formatSeconds(report.maxDurationMs)} / 600초 초과: ${report.over600sCount}건`,
    `- 채택률 현재: ${formatRate(report.adoption.current.ratePercent, report.adoption.current.adopted + report.adoption.current.rejected)}, 직전: ${formatRate(report.adoption.previous.ratePercent, report.adoption.previous.adopted + report.adoption.previous.rejected)}`,
    `- 게시 방식 현재: ${JSON.stringify(report.postModeCounts.current)}, 직전: ${JSON.stringify(report.postModeCounts.previous)}`,
  ].join('\n');

const main = async (): Promise<void> => {
  const days = readDays(process.argv.slice(2));
  const now = Date.now();
  const windowStart = new Date(now - days * DAY_MS);
  const previousWindowStart = new Date(now - 2 * days * DAY_MS);
  const prisma = new PrismaClient();
  try {
    // input_snapshot JSON 조회는 인덱스가 없어 기간으로 먼저 자른다.
    const agentRuns = await prisma.agentRun.findMany({
      where: {
        agentType: AgentType.CODE_REVIEWER,
        triggerType: TriggerType.PR_REVIEW_SWEEP,
        startedAt: { gte: previousWindowStart },
      },
      select: {
        id: true,
        startedAt: true,
        durationMs: true,
        status: true,
        inputSnapshot: true,
      },
    });
    const runs: RepoReadRunRow[] = agentRuns.flatMap((agentRun) => {
      const repo = snapshotField(agentRun.inputSnapshot, 'repo');
      if (repo === undefined) {
        return [];
      }
      return [
        {
          repo,
          startedAt: agentRun.startedAt,
          durationMs: agentRun.durationMs,
          status: agentRun.status,
          repoRead: snapshotField(agentRun.inputSnapshot, 'repoRead'),
          repoReadFallbackReason: snapshotField(
            agentRun.inputSnapshot,
            'repoReadFallbackReason',
          ),
        },
      ];
    });
    const cards = await prisma.prReviewFinding.findMany({
      // 비교 구간보다 먼저 만든 카드도 구간 안에 결론이 났으면 채택률에 들어가야 한다.
      // 스윕 리뷰 카드만 보려고 원장 행의 triggerType 으로 거른다.
      where: {
        OR: [
          { agentRunId: { in: agentRuns.map((agentRun) => agentRun.id) } },
          {
            decidedAt: { gte: previousWindowStart },
            agentRun: { triggerType: TriggerType.PR_REVIEW_SWEEP },
          },
        ],
      },
      select: {
        repo: true,
        status: true,
        postMode: true,
        decidedAt: true,
        createdAt: true,
      },
    });
    const reports = summarizeRepoRead({
      runs,
      cards,
      windowStart,
      previousWindowStart,
    });
    process.stdout.write(
      `# 레포 사본 리뷰 지표 — 최근 ${days}일 vs 직전 ${days}일\n\n` +
        (reports.length === 0
          ? '스윕 리뷰 기록이 없다.\n'
          : `${reports.map(render).join('\n\n')}\n`),
    );
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
