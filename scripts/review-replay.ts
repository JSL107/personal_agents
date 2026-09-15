/**
 * 사람이 판정한 PR 지적을 당시 headSha로 다시 리뷰한다. 모델 구독 쿼터를 쓴다.
 * diff는 PR에 고정된 base SHA와 당시 headSha 사이로 재구성한다 — base를 브랜치 이름으로 잡으면
 * 그 사이 base가 head를 흡수한 PR에서 빈 diff가 나온다(실측: sbe-api-v5-puppeteer#152 0 bytes).
 * 파일 목록과 증감 줄 수는 그 diff에서 다시 센다. 제목·본문·작성자는 현재 값이다 —
 * GitHub가 과거 시점의 PR 본문을 주지 않으므로, 그 뒤 수정된 PR은 입력이 완전히 같지는 않다.
 * 학습 규약에는 재생 대상의 기각 사유가 이미 포함될 수 있어, 운영과 같은 조건이지만
 * 오탐 억제 성능을 과대평가할 수 있다. 중요한 변경은 같은 --ids로 두 번 실행한다.
 * 리플레이 run은 CODE_REVIEWER/MANUAL로 원장에 남는다. 스윕 판정은
 * PR_REVIEW_SWEEP만 조회하므로 스윕 쿨다운에는 영향이 없다.
 * AppModule 대신 리뷰 모듈만 부팅해 BullMQ repeatable job 재등록을 피한다.
 */
import { writeFileSync } from 'node:fs';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrReviewFinding } from '@prisma/client';

import { ReviewPullRequestUsecase } from '../src/agent/code-reviewer/application/review-pull-request.usecase';
import { CodeReviewerModule } from '../src/agent/code-reviewer/code-reviewer.module';
import { TriggerType } from '../src/agent-run/domain/agent-run.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../src/github/domain/port/github-client.port';
import {
  FindingReplayResult,
  LabeledFinding,
  ReplayPair,
  ReplayRate,
  scoreReplay,
} from '../src/pr-review-loop/domain/review-replay.score';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

// --ids 로 표본을 고정하면 개수 옵션은 쓰이지 않으므로 보고서에도 남기지 않는다.
interface ReplayOptions {
  rejected?: number;
  fixed?: number;
  ids?: number[];
  repo?: string;
  out?: string;
}

interface ReplayGroup {
  repo: string;
  pullNumber: number;
  headSha: string;
  findings: LabeledFinding[];
}

interface ReplayGroupReport {
  repo: string;
  pullNumber: number;
  headSha: string;
  agentRunId: number;
  modelUsed: string;
  elapsedMs: number;
  diffTruncated: boolean;
  results: FindingReplayResult[];
}

interface SkippedGroup {
  repo: string;
  pullNumber: number;
  headSha: string;
  findingIds: number[];
  reason: string;
}

interface ReplayReport {
  generatedAt: string;
  options: ReplayOptions;
  score: { rejected: ReplayRate; fixed: ReplayRate };
  groups: ReplayGroupReport[];
  skipped: SkippedGroup[];
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CodeReviewerModule,
  ],
})
class ReviewReplayModule {}

const main = async (): Promise<void> => {
  const options = readOptions();
  const application = await NestFactory.createApplicationContext(
    ReviewReplayModule,
    {
      logger: {
        log: () => undefined,
        error: (message: unknown) =>
          process.stderr.write(`${String(message)}\n`),
        warn: (message: unknown) =>
          process.stderr.write(`${String(message)}\n`),
      },
    },
  );
  try {
    const prisma = application.get(PrismaService);
    const github = application.get<GithubClientPort>(GITHUB_CLIENT_PORT);
    const usecase = application.get(ReviewPullRequestUsecase);
    const rows = await selectFindings(prisma, options);
    const groups = groupFindings(rows);
    const reportGroups: ReplayGroupReport[] = [];
    const skipped: SkippedGroup[] = [];
    const pairs: ReplayPair[] = [];

    for (const group of groups) {
      const { repo: repository, pullNumber, headSha } = group;
      const startedAt = Date.now();
      try {
        const currentDetail = await github.getPullRequest({
          repo: repository,
          number: pullNumber,
        });
        const diff = await github.compareCommits({
          repo: repository,
          baseSha: currentDetail.baseSha,
          headSha,
        });
        const detail = {
          ...currentDetail,
          headSha,
          ...summarizeDiff(diff.diff),
        };
        const outcome = await usecase.execute({
          prRef: `${repository}#${pullNumber}`,
          slackUserId: 'cli-review-replay',
          triggerType: TriggerType.MANUAL,
          snapshot: { detail, diff },
        });
        const groupPairs = group.findings.map(
          (labeled): ReplayPair => ({
            labeled,
            replayed: outcome.result.findings,
          }),
        );
        const groupScore = scoreReplay(groupPairs);
        reportGroups.push({
          repo: repository,
          pullNumber,
          headSha,
          agentRunId: outcome.agentRunId,
          modelUsed: outcome.modelUsed,
          elapsedMs: Date.now() - startedAt,
          diffTruncated: diff.truncated,
          results: groupScore.results,
        });
        pairs.push(...groupPairs);
      } catch (error: unknown) {
        skipped.push({
          repo: repository,
          pullNumber,
          headSha,
          findingIds: group.findings.map((finding) => finding.id),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const { rejected, fixed } = scoreReplay(pairs);
    const report: ReplayReport = {
      generatedAt: new Date().toISOString(),
      options,
      score: { rejected, fixed },
      groups: reportGroups,
      skipped,
    };
    const serialized = JSON.stringify(report, null, 2);
    if (options.out !== undefined) {
      writeFileSync(options.out, `${serialized}\n`, 'utf8');
    }
    process.stdout.write(`${serialized}\n`);
    process.stderr.write(
      `오탐 재발 ${rejected.reproduced}/${rejected.total}\n정탐 유지 ${fixed.reproduced}/${fixed.total}\n스킵 ${skipped.length}\n`,
    );
  } finally {
    await application.close();
  }
};

// 프롬프트에 실리는 파일 목록·증감 줄 수를 재생 diff에서 다시 센다. 현재 PR 값을 그대로 두면
// 모델이 보는 diff와 메타데이터가 어긋난다(카드 이후 커밋이 더 붙은 PR).
interface DiffSummary {
  changedFiles: string[];
  changedFilesTotalCount: number;
  changedFilesTruncated: boolean;
  additions: number;
  deletions: number;
}

const summarizeDiff = (diff: string): DiffSummary => {
  const changedFiles: string[] = [];
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      changedFiles.push(line.slice('+++ b/'.length).trim());
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
      continue;
    }
    if (line.startsWith('-')) {
      deletions += 1;
    }
  }
  return {
    changedFiles,
    changedFilesTotalCount: changedFiles.length,
    changedFilesTruncated: false,
    additions,
    deletions,
  };
};

const selectFindings = async (
  prisma: PrismaService,
  options: ReplayOptions,
): Promise<PrReviewFinding[]> => {
  if (options.ids !== undefined) {
    const rows = await prisma.prReviewFinding.findMany({
      where: { id: { in: options.ids }, repo: options.repo },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const selected = rows.filter((row) => {
      const eligible =
        (row.status === 'REJECTED' || row.status === 'FIXED') &&
        row.headSha !== '';
      if (!eligible) {
        process.stderr.write(
          `경고: finding ${row.id} 제외 (status=${row.status}, headSha=${row.headSha || '없음'})\n`,
        );
      }
      return eligible;
    });
    const foundIds = new Set(rows.map((row) => row.id));
    for (const id of options.ids) {
      if (!foundIds.has(id)) {
        process.stderr.write(
          `경고: finding ${id} 제외 (없거나 --repo 필터 불일치)\n`,
        );
      }
    }
    return selected;
  }

  const rows: PrReviewFinding[] = [];
  for (const status of ['REJECTED', 'FIXED'] as const) {
    const take =
      (status === 'REJECTED' ? options.rejected : options.fixed) ?? 0;
    if (take === 0) {
      continue;
    }
    const selected = await prisma.prReviewFinding.findMany({
      where: { status, repo: options.repo, headSha: { not: '' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
    rows.push(...selected);
  }
  return rows;
};

const groupFindings = (rows: readonly PrReviewFinding[]): ReplayGroup[] => {
  const groups = new Map<string, ReplayGroup>();
  for (const row of rows) {
    if (row.status !== 'REJECTED' && row.status !== 'FIXED') {
      continue;
    }
    const key = JSON.stringify([row.repo, row.pullNumber, row.headSha]);
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        repo: row.repo,
        pullNumber: row.pullNumber,
        headSha: row.headSha,
        findings: [],
      };
      groups.set(key, group);
    }
    group.findings.push({
      id: row.id,
      label: row.status,
      filePath: row.filePath,
      line: row.line,
      category: row.category,
      body: row.body,
    });
  }
  return Array.from(groups.values());
};

const readOptions = (): ReplayOptions => {
  const rawIds = readOption('ids');
  const ids =
    rawIds === undefined
      ? undefined
      : Array.from(
          new Set(
            rawIds
              .split(',')
              .map((value) => readInteger(value.trim(), 'ids', 1)),
          ),
        );
  const repository = readOption('repo');
  if (repository !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error('--repo는 owner/repo 형식이어야 합니다.');
  }
  if (ids !== undefined) {
    return { ids, repo: repository, out: readOption('out') };
  }
  return {
    rejected: readInteger(readOption('rejected') ?? '5', 'rejected', 0),
    fixed: readInteger(readOption('fixed') ?? '5', 'fixed', 0),
    repo: repository,
    out: readOption('out'),
  };
};

const readInteger = (value: string, name: string, minimum: number): number => {
  const parsed = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(parsed) ||
    parsed < minimum
  ) {
    throw new Error(`--${name}는 ${minimum} 이상의 정수여야 합니다.`);
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
