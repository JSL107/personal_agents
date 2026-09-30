/**
 * 사람이 판정한 PR 지적을 당시 headSha로 다시 리뷰한다. 모델 구독 쿼터를 쓴다.
 * diff는 PR에 고정된 base SHA와 당시 headSha 사이로 재구성한다 — base를 브랜치 이름으로 잡으면
 * 그 사이 base가 head를 흡수한 PR에서 빈 diff가 나온다(실측: sbe-api-v5-puppeteer#152 0 bytes).
 * 파일 목록과 증감 줄 수는 그 diff에서 다시 센다. 제목·본문·작성자는 현재 값이다 —
 * GitHub가 과거 시점의 PR 본문을 주지 않으므로, 그 뒤 수정된 PR은 입력이 완전히 같지는 않다.
 * 학습 규약에는 재생 대상의 기각 사유가 이미 포함될 수 있어, 운영과 같은 조건이지만
 * 오탐 억제 성능을 과대평가할 수 있다. --holdout 은 재생 대상 카드를 규약 재료에서 빼고 돈다.
 * 모델 출력은 회차마다 흔들리므로 비교는 --trials 2 이상으로, 이전 보고서는 --baseline 으로 붙인다.
 * 한 번 실행의 모델 호출 수는 (PR·headSha 그룹 수) × trials 다.
 * --misses <json> 은 카드가 없는 미탐(외부 리뷰가 잡고 이대리는 놓친 결함)을 함께 재생해 미탐 재현율을 잰다.
 * 형식은 `src/pr-review-loop/domain/review-replay-misses.ts`. 회사 저장소 위치가 담기므로 저장소에 커밋하지 않는다.
 * 미탐만 재려면 --rejected 0 --fixed 0 을 함께 준다.
 * --rescore <보고서> 는 모델을 부르지 않고, 그 보고서의 모델 출력(원장 agent_run.output)을 현재 판정 규칙으로
 * 다시 매긴다. 판정 규칙이 바뀐 뒤 기준선을 쿼터 없이 다시 만드는 용도다. --baseline 과 함께 쓸 수 있고,
 * --misses 를 주면 미탐 본문·줄·경로를 그 파일(보고서가 쓴 미탐 파일과 같은 순서)로 바꿔 채점한다.
 * 리플레이 run은 CODE_REVIEWER/MANUAL로 원장에 남는다. 스윕 판정은
 * PR_REVIEW_SWEEP만 조회하므로 스윕 쿨다운에는 영향이 없다.
 * AppModule 대신 리뷰 모듈만 부팅해 BullMQ repeatable job 재등록을 피한다.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { INestApplicationContext, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrReviewFinding } from '@prisma/client';

import { ReviewPullRequestUsecase } from '../src/agent/code-reviewer/application/review-pull-request.usecase';
import { CodeReviewerModule } from '../src/agent/code-reviewer/code-reviewer.module';
import { TriggerType } from '../src/agent-run/domain/agent-run.type';
import {
  PullRequestDetail,
  PullRequestDiff,
} from '../src/github/domain/github.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../src/github/domain/port/github-client.port';
import {
  BaselineComparison,
  BaselineSummaries,
  compareMissedIntactWithBaseline,
  compareWithBaseline,
  FindingReplayResult,
  intactMissedIdsOf,
  isSameSample,
  LabeledFinding,
  readBaselineSummaries,
  REPLAY_SCORER_VERSION,
  ReplayedFinding,
  replayedFindingsOf,
  ReplayLabel,
  ReplayPair,
  ReplayRate,
  sampleIdsOf,
  scoreReplay,
  scorerVersionOf,
  skippedCountOf,
  summarizeTrials,
  summarizeTrialsByTruncation,
  TrialSummary,
  TruncationSplit,
} from '../src/pr-review-loop/domain/review-replay.score';
import { summarizeDiff } from '../src/pr-review-loop/domain/review-replay-diff';
import {
  MissedFindingEntry,
  missedFindingId,
  pairReplacementMisses,
  parseMissedFindings,
  resolveMissPath,
  toMissedLabeledFinding,
} from '../src/pr-review-loop/domain/review-replay-misses';

// 미탐을 어느 커밋으로 재생했는지. 원장의 리뷰 실행 기록(agent_run)에는 리뷰한 커밋이 남지 않아,
// 입력에 없으면 그 PR 의 가장 최근 카드 커밋을 쓴다. 이대리가 마지막 리뷰에서 지적을 하나도 안
// 냈다면 그 커밋은 카드가 없어 이전 커밋이 잡힌다 — 그래서 출처를 보고서에 남긴다.
interface ResolvedMiss {
  id: number;
  repo: string;
  pullNumber: number;
  headSha: string;
  headShaSource: 'input' | 'latest-card';
}

// 파일 이름만 있던 미탐 중 전체 경로로 바꾸지 못한 것
interface MissPathNote {
  id: number;
  repo: string;
  pullNumber: number;
  filePath: string;
  kind: 'not-in-diff' | 'ambiguous';
  candidates?: string[];
}
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

// --ids 로 표본을 고정하면 개수 옵션은 쓰이지 않으므로 보고서에도 남기지 않는다.
interface ReplayOptions {
  rejected?: number;
  fixed?: number;
  ids?: number[];
  repo?: string;
  out?: string;
  trials: number;
  holdout: boolean;
  baseline?: string;
  misses?: string;
  // 재채점한 원래 보고서. 있으면 모델을 부르지 않은 보고서다.
  rescore?: string;
  // 재채점에서 미탐 본문·줄·경로를 바꿔 끼운 파일. id 는 misses 파일로 맞춘다.
  missesReplacement?: string;
}

interface ReplayGroup {
  repo: string;
  pullNumber: number;
  headSha: string;
  findings: LabeledFinding[];
}

interface ReplayGroupReport {
  trial: number;
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
  trial: number;
  repo: string;
  pullNumber: number;
  headSha: string;
  findingIds: number[];
  reason: string;
}

interface ReplayReport {
  generatedAt: string;
  // 재현 판정 규칙의 버전. 규칙이 다른 보고서끼리는 재현율을 비교할 수 없다.
  scorerVersion: number;
  options: ReplayOptions;
  // 모든 회차를 합친 값. trials=1 이면 종전 보고서와 같다.
  score: { rejected: ReplayRate; fixed: ReplayRate; missed: ReplayRate };
  trials: {
    rejected: TrialSummary;
    fixed: TrialSummary;
    missed?: TrialSummary;
    // 위 값을 diff 잘림 여부로 나눈 것. 잘린 그룹은 입력 누락과 모델 미탐이 섞인다.
    byDiffTruncation: {
      rejected: TruncationSplit;
      fixed: TruncationSplit;
      missed?: TruncationSplit;
    };
  };
  baseline?: {
    path: string;
    // 두 보고서가 같은 카드를 스킵 없이, 같은 판정 규칙으로 쟀는가. 아니면 차이는 프롬프트가 아니라
    // 문제지나 채점 탓일 수 있다.
    sameSample: boolean;
    sameScorer: boolean;
    rejected: BaselineComparison;
    fixed: BaselineComparison;
    missed?: BaselineComparison;
    // 미탐 통과 판정은 이 값으로 한다(diff 안 잘린 그룹). 위 missed 는 합친 값이라 참고용.
    missedIntact?: BaselineComparison;
  };
  // 리뷰한 커밋을 원장에서 찾지 못해 재생하지 못한 미탐
  unresolvedMisses: MissedFindingEntry[];
  resolvedMisses: ResolvedMiss[];
  missPathNotes: MissPathNote[];
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

// 재채점은 모델도 GitHub 도 부르지 않는다 — 원장만 읽으므로 리뷰 모듈을 띄우지 않는다.
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
})
class ReviewRescoreModule {}

// 재생 또는 재채점이 모은 것. 보고서 집계·비교·출력은 둘이 같은 길을 탄다.
interface ReplayRun {
  options: ReplayOptions;
  groups: ReplayGroupReport[];
  skipped: SkippedGroup[];
  unresolvedMisses: MissedFindingEntry[];
  resolvedMisses: ResolvedMiss[];
  missPathNotes: MissPathNote[];
  // 합친 점수(score)용. 회차별 결과를 모두 이은 것이다.
  pairs: ReplayPair[];
  hasMisses: boolean;
  notes: string[];
}

const main = async (): Promise<void> => {
  const options = readOptions();
  const application = await NestFactory.createApplicationContext(
    options.rescore === undefined ? ReviewReplayModule : ReviewRescoreModule,
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
    // 기준선은 모델을 부르기 전에 읽는다 — 경로가 틀려 쿼터만 쓰고 끝나지 않게.
    const baselineReport =
      options.baseline === undefined
        ? undefined
        : readBaseline(options.baseline);
    const run =
      options.rescore === undefined
        ? await replay(application, prisma, options)
        : await rescore(prisma, options, options.rescore);
    writeReport(run, baselineReport);
  } finally {
    await application.close();
  }
};

const replay = async (
  application: INestApplicationContext,
  prisma: PrismaService,
  options: ReplayOptions,
): Promise<ReplayRun> => {
  const github = application.get<GithubClientPort>(GITHUB_CLIENT_PORT);
  const usecase = application.get(ReviewPullRequestUsecase);
  const misses = options.misses === undefined ? [] : readMisses(options.misses);
  const rows = await selectFindings(prisma, options);
  const groups = groupFindings(rows);
  const { unresolved: unresolvedMisses, resolved: resolvedMisses } =
    await addMisses(prisma, groups, misses);
  const missPathNotes: MissPathNote[] = [];
  // 미탐은 카드가 없어(음수 id) 규약 재료가 아니다 — 카드 id 만 뺀다.
  const holdoutIds = options.holdout
    ? groups.flatMap((group) =>
        group.findings.map((finding) => finding.id).filter((id) => id > 0),
      )
    : undefined;
  const reportGroups: ReplayGroupReport[] = [];
  const skipped: SkippedGroup[] = [];
  const pairs: ReplayPair[] = [];

  for (const group of groups) {
    const { repo: repository, pullNumber, headSha } = group;
    // diff 는 회차가 달라도 같으므로 그룹마다 한 번만 가져온다.
    let snapshot: { detail: PullRequestDetail; diff: PullRequestDiff };
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
      snapshot = {
        detail: { ...currentDetail, headSha, ...summarizeDiff(diff.diff) },
        diff,
      };
      const changedFiles = snapshot.detail.changedFiles;
      group.findings = group.findings.map((finding) => {
        if (finding.label !== 'MISSED' || finding.filePath === null) {
          return finding;
        }
        const resolution = resolveMissPath(finding.filePath, changedFiles);
        if (
          resolution.kind === 'not-in-diff' ||
          resolution.kind === 'ambiguous'
        ) {
          missPathNotes.push({
            id: finding.id,
            repo: repository,
            pullNumber,
            filePath: finding.filePath,
            kind: resolution.kind,
            ...(resolution.kind === 'ambiguous'
              ? { candidates: resolution.candidates }
              : {}),
          });
        }
        return { ...finding, filePath: resolution.filePath };
      });
    } catch (error: unknown) {
      for (let trial = 1; trial <= options.trials; trial += 1) {
        skipped.push(toSkipped(group, trial, error));
      }
      continue;
    }
    for (let trial = 1; trial <= options.trials; trial += 1) {
      const startedAt = Date.now();
      try {
        const outcome = await usecase.execute({
          prRef: `${repository}#${pullNumber}`,
          slackUserId: 'cli-review-replay',
          triggerType: TriggerType.MANUAL,
          snapshot,
          ...(holdoutIds === undefined
            ? {}
            : { excludeConventionFindingIds: holdoutIds }),
        });
        const groupPairs = group.findings.map(
          (labeled): ReplayPair => ({
            labeled,
            replayed: outcome.result.findings,
          }),
        );
        const groupScore = scoreReplay(groupPairs);
        pairs.push(...groupPairs);
        reportGroups.push({
          trial,
          repo: repository,
          pullNumber,
          headSha,
          agentRunId: outcome.agentRunId,
          modelUsed: outcome.modelUsed,
          elapsedMs: Date.now() - startedAt,
          diffTruncated: snapshot.diff.truncated,
          results: groupScore.results,
        });
      } catch (error: unknown) {
        skipped.push(toSkipped(group, trial, error));
      }
    }
  }
  return {
    options,
    groups: reportGroups,
    skipped,
    unresolvedMisses,
    resolvedMisses,
    missPathNotes,
    pairs,
    hasMisses: misses.length > 0,
    notes: [],
  };
};

// 저장된 보고서의 모델 출력(원장 agent_run.output)을 현재 판정 규칙으로 다시 매긴다. 모델 호출 0.
// 판정 규칙이 바뀔 때마다 쿼터를 들여 기준선을 다시 돌리지 않으려는 것이다 — 규칙 v1 → v2 에서
// 저장된 보고서 3종이 한꺼번에 기준선 자격을 잃었다(docs/superpowers/plans/2026-09-29-review-replay-trials.md §8-7).
// 표본은 보고서의 결과 id 그대로다. 카드는 원장에서 본문을 다시 읽고, 미탐은 보고서가 쓴 미탐 파일로
// id 를 맞춘다. --misses 를 주면 그 파일의 본문·줄·경로로 바꿔 채점한다(pairReplacementMisses).
// diff 는 다시 받지 않으므로 잘림 여부·스킵·미탐 경로 메모는 원래 보고서 것을 쓴다.
const rescore = async (
  prisma: PrismaService,
  options: ReplayOptions,
  path: string,
): Promise<ReplayRun> => {
  const saved = readSavedReport(path);
  const replacementPath = options.misses ?? saved.options.missesReplacement;
  const labeledById = new Map<number, LabeledFinding>();
  const results = saved.groups.flatMap((group) => group.results);

  const cardIds = [
    ...new Set(results.map((result) => result.id).filter((id) => id > 0)),
  ];
  const labelOf = new Map(results.map((result) => [result.id, result.label]));
  const rows = await prisma.prReviewFinding.findMany({
    where: { id: { in: cardIds } },
  });
  for (const row of rows) {
    // 라벨은 보고서 것을 쓴다 — 그 뒤 카드 상태가 바뀌었어도 표본은 원래 실행과 같아야 한다.
    labeledById.set(row.id, {
      id: row.id,
      label: labelOf.get(row.id) as ReplayLabel,
      filePath: row.filePath,
      line: row.line,
      category: row.category,
      body: row.body,
    });
  }

  const notes: string[] = [];
  if (results.some((result) => result.id < 0)) {
    if (saved.options.misses === undefined) {
      throw new Error(
        `--rescore ${path} 에 미탐 결과가 있는데 보고서에 미탐 파일 경로(options.misses)가 없다.`,
      );
    }
    const original = readMisses(saved.options.misses);
    if (replacementPath === undefined) {
      for (const entry of original) {
        const labeled = toMissedLabeledFinding(entry);
        labeledById.set(labeled.id, labeled);
      }
    } else {
      const replacement = readMisses(replacementPath);
      const { labeled, errors } = pairReplacementMisses(original, replacement);
      if (errors.length > 0) {
        throw new Error(
          `--misses ${replacementPath} 를 ${saved.options.misses} 와 짝지을 수 없다:\n${errors.join('\n')}`,
        );
      }
      for (const finding of labeled) {
        labeledById.set(finding.id, finding);
      }
      // 교체 목록의 줄은 외부 리뷰가 본 커밋 기준이다. 재생 커밋이 그와 다르면 줄이 어긋나 있을 수 있다.
      const replayedShaOf = new Map(
        saved.resolvedMisses.map((miss) => [miss.id, miss.headSha]),
      );
      const shifted = original.filter((entry, index) => {
        const anchorSha = replacement[index].headSha;
        const replayedSha = replayedShaOf.get(missedFindingId(entry));
        return (
          anchorSha !== undefined &&
          replayedSha !== undefined &&
          anchorSha !== replayedSha
        );
      }).length;
      if (shifted > 0) {
        notes.push(
          `주의: 교체 미탐 ${shifted}건은 외부 리뷰 커밋과 재생 커밋이 달라 줄이 어긋나 있을 수 있다 — 본문 겹침으로만 잡힐 수 있다`,
        );
      }
    }
  }

  const missing = [...new Set(results.map((result) => result.id))].filter(
    (id) => !labeledById.has(id),
  );
  if (missing.length > 0) {
    throw new Error(
      `--rescore ${path} 의 결과 id ${missing.join(', ')} 를 원장이나 미탐 파일에서 찾지 못했다 — 표본이 달라지므로 멈춘다.`,
    );
  }

  const agentRunIds = [
    ...new Set(saved.groups.map((group) => group.agentRunId)),
  ];
  const outputs = await prisma.agentRun.findMany({
    where: { id: { in: agentRunIds } },
    select: { id: true, output: true },
  });
  const replayedByRun = new Map<number, ReplayedFinding[]>();
  for (const run of outputs) {
    const findings = replayedFindingsOf(run.output);
    if (findings !== null) {
      replayedByRun.set(run.id, findings);
    }
  }
  const unreadable = agentRunIds.filter((id) => !replayedByRun.has(id));
  if (unreadable.length > 0) {
    throw new Error(
      `agent_run ${unreadable.join(', ')} 의 리뷰 결과를 읽지 못했다(없거나 형식이 다름) — 모델 출력이 없으면 재채점할 수 없다.`,
    );
  }

  const pairs: ReplayPair[] = [];
  const groups = saved.groups.map((group): ReplayGroupReport => {
    const replayed = replayedByRun.get(group.agentRunId) ?? [];
    const groupPairs = group.results.map(
      (result): ReplayPair => ({
        labeled: labeledById.get(result.id) as LabeledFinding,
        replayed,
      }),
    );
    pairs.push(...groupPairs);
    return { ...group, results: scoreReplay(groupPairs).results };
  });
  return {
    options: {
      ...saved.options,
      rescore: path,
      ...(replacementPath === undefined
        ? {}
        : { missesReplacement: replacementPath }),
      out: options.out,
      baseline: options.baseline,
    },
    groups,
    skipped: saved.skipped,
    unresolvedMisses: saved.unresolvedMisses,
    resolvedMisses: saved.resolvedMisses,
    missPathNotes: saved.missPathNotes,
    pairs,
    hasMisses: saved.options.misses !== undefined,
    notes: [
      `재채점: ${path} 의 모델 출력을 판정 규칙 v${REPLAY_SCORER_VERSION} 로 다시 매겼다 (모델 호출 없음)`,
      ...notes,
    ],
  };
};

const writeReport = (
  run: ReplayRun,
  baselineReport: ReturnType<typeof readBaseline> | undefined,
): void => {
  const {
    options,
    groups: reportGroups,
    skipped,
    unresolvedMisses,
    resolvedMisses,
    missPathNotes,
  } = run;
  const trialResults: FindingReplayResult[][] = Array.from(
    { length: options.trials },
    () => [],
  );
  for (const group of reportGroups) {
    trialResults[group.trial - 1].push(...group.results);
  }
  const { rejected, fixed, missed } = scoreReplay(run.pairs);
  const trials = {
    rejected: summarizeTrials(trialResults, 'REJECTED'),
    fixed: summarizeTrials(trialResults, 'FIXED'),
    ...(run.hasMisses
      ? { missed: summarizeTrials(trialResults, 'MISSED') }
      : {}),
    byDiffTruncation: {
      rejected: summarizeTrialsByTruncation(
        reportGroups,
        options.trials,
        'REJECTED',
      ),
      fixed: summarizeTrialsByTruncation(reportGroups, options.trials, 'FIXED'),
      ...(run.hasMisses
        ? {
            missed: summarizeTrialsByTruncation(
              reportGroups,
              options.trials,
              'MISSED',
            ),
          }
        : {}),
    },
  };
  const baselineMissed = baselineReport?.summaries.missed;
  const latestCardMisses = resolvedMisses.filter(
    (miss) => miss.headShaSource === 'latest-card',
  ).length;
  const sameScorer = baselineReport?.scorerVersion === REPLAY_SCORER_VERSION;
  const report: ReplayReport = {
    generatedAt: new Date().toISOString(),
    scorerVersion: REPLAY_SCORER_VERSION,
    options,
    score: { rejected, fixed, missed },
    trials,
    ...(baselineReport === undefined || options.baseline === undefined
      ? {}
      : {
          baseline: {
            path: options.baseline,
            sameScorer,
            sameSample:
              sameScorer &&
              baselineReport.skipped === 0 &&
              skipped.length === 0 &&
              isSameSample(
                baselineReport.sampleIds,
                sampleIdsOf({ groups: reportGroups }),
              ),
            rejected: compareWithBaseline(
              trials.rejected,
              baselineReport.summaries.rejected,
              'REJECTED',
            ),
            fixed: compareWithBaseline(
              trials.fixed,
              baselineReport.summaries.fixed,
              'FIXED',
            ),
            ...(trials.missed === undefined || baselineMissed === undefined
              ? {}
              : {
                  missed: compareWithBaseline(trials.missed, baselineMissed),
                }),
            // 기준선에 미탐이 없어도 이 줄은 낸다 — 빠지면 미탐 판정 기준이 콘솔에서 조용히 사라진다.
            ...(trials.byDiffTruncation.missed === undefined
              ? {}
              : {
                  missedIntact: compareMissedIntactWithBaseline(
                    trials.byDiffTruncation.missed.intact,
                    baselineReport.summaries.missedIntact,
                    isSameSample(
                      baselineReport.intactMissedIds,
                      intactMissedIdsOf({ groups: reportGroups }),
                    ),
                  ),
                }),
          },
        }),
    unresolvedMisses,
    resolvedMisses,
    missPathNotes,
    groups: reportGroups,
    skipped,
  };
  const serialized = JSON.stringify(report, null, 2);
  if (options.out !== undefined) {
    writeFileSync(options.out, `${serialized}\n`, 'utf8');
  }
  process.stdout.write(`${serialized}\n`);
  process.stderr.write(
    [
      ...run.notes,
      `회차 ${options.trials}${options.holdout ? ' · holdout' : ''}`,
      formatTrialLine('오탐 재발', trials.rejected),
      ...formatSplitLines(trials.byDiffTruncation.rejected),
      formatTrialLine('정탐 유지', trials.fixed),
      ...formatSplitLines(trials.byDiffTruncation.fixed),
      ...(trials.missed === undefined
        ? []
        : [formatTrialLine('미탐 재현', trials.missed)]),
      ...(trials.byDiffTruncation.missed === undefined
        ? []
        : formatSplitLines(trials.byDiffTruncation.missed)),
      ...(unresolvedMisses.length === 0
        ? []
        : [`미탐 중 리뷰 커밋을 못 찾아 뺀 것 ${unresolvedMisses.length}`]),
      ...(latestCardMisses === 0
        ? []
        : [
            `경고: 미탐 ${latestCardMisses}건은 headSha 가 없어 마지막 카드 커밋으로 재생했다 — 외부 리뷰 뒤에 결함이 고쳐졌으면 잡을 대상이 없다. original_commit_id 를 넣을 것`,
          ]),
      ...(missPathNotes.length === 0
        ? []
        : [
            `미탐 중 전체 경로를 못 정한 것 ${missPathNotes.length} (보고서 missPathNotes — 이름만으로 매칭된다)`,
          ]),
      ...(report.baseline === undefined
        ? []
        : [
            ...(report.baseline.sameScorer
              ? []
              : [
                  `경고: 기준선은 판정 규칙 v${baselineReport?.scorerVersion} 로, 이번은 v${REPLAY_SCORER_VERSION} 로 채점했다 — 재현율을 비교할 수 없다. 기준선을 다시 돌릴 것`,
                ]),
            ...(report.baseline.sameSample
              ? []
              : [
                  '경고: 기준선과 측정한 카드가 다르거나 어느 쪽에 스킵이 있다 — 차이는 문제지 탓일 수 있다. 같은 --ids 로 스킵 없이 다시 돌릴 것',
                ]),
            formatBaselineLine(
              '오탐 재발',
              report.baseline.rejected,
              passRuleNote(
                report.baseline.rejected,
                report.baseline.sameSample,
              ),
            ),
            formatBaselineLine(
              '정탐 유지',
              report.baseline.fixed,
              passRuleNote(report.baseline.fixed, report.baseline.sameSample),
            ),
            ...(report.baseline.missed === undefined
              ? []
              : [formatBaselineLine('미탐 재현', report.baseline.missed)]),
            ...(report.baseline.missedIntact === undefined
              ? []
              : [
                  formatBaselineLine(
                    '미탐 재현(diff 안 잘림, 판정 기준)',
                    report.baseline.missedIntact,
                    passRuleNote(
                      report.baseline.missedIntact,
                      report.baseline.sameSample,
                    ),
                  ),
                ]),
          ]),
      `스킵 ${skipped.length}`,
      '',
    ].join('\n'),
  );
};

const toSkipped = (
  group: ReplayGroup,
  trial: number,
  error: unknown,
): SkippedGroup => ({
  trial,
  repo: group.repo,
  pullNumber: group.pullNumber,
  headSha: group.headSha,
  findingIds: group.findings.map((finding) => finding.id),
  reason: error instanceof Error ? error.message : String(error),
});

const readBaseline = (
  path: string,
): {
  summaries: BaselineSummaries;
  sampleIds: number[];
  intactMissedIds: number[];
  skipped: number;
  scorerVersion: number;
} => {
  const report: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const summaries = readBaselineSummaries(report);
  if (summaries === null) {
    throw new Error(
      `--baseline ${path} 는 review:replay 보고서 형식이 아닙니다.`,
    );
  }
  return {
    summaries,
    sampleIds: sampleIdsOf(report),
    intactMissedIds: intactMissedIdsOf(report),
    skipped: skippedCountOf(report),
    scorerVersion: scorerVersionOf(report),
  };
};

// 재채점할 보고서. 표본(결과 id)과 모델 출력 위치(agentRunId)만 있으면 되지만, 형식이 틀린 채로 읽으면
// 일부 그룹이 조용히 빠진 재현율이 나오므로 그룹마다 확인한다.
const readSavedReport = (
  path: string,
): Pick<
  ReplayReport,
  | 'options'
  | 'groups'
  | 'skipped'
  | 'unresolvedMisses'
  | 'resolvedMisses'
  | 'missPathNotes'
> => {
  const report = JSON.parse(
    readFileSync(path, 'utf8'),
  ) as Partial<ReplayReport>;
  const labels: readonly unknown[] = ['REJECTED', 'FIXED', 'MISSED'];
  const valid =
    typeof report.options?.trials === 'number' &&
    Array.isArray(report.groups) &&
    report.groups.every(
      (group) =>
        typeof group.agentRunId === 'number' &&
        Number.isInteger(group.trial) &&
        group.trial >= 1 &&
        group.trial <= (report.options?.trials ?? 0) &&
        typeof group.diffTruncated === 'boolean' &&
        Array.isArray(group.results) &&
        group.results.every(
          (result) =>
            typeof result.id === 'number' && labels.includes(result.label),
        ),
    );
  if (!valid || report.options === undefined || report.groups === undefined) {
    throw new Error(
      `--rescore ${path} 는 review:replay 보고서 형식이 아닙니다.`,
    );
  }
  return {
    options: report.options,
    groups: report.groups,
    skipped: report.skipped ?? [],
    unresolvedMisses: report.unresolvedMisses ?? [],
    resolvedMisses: report.resolvedMisses ?? [],
    missPathNotes: report.missPathNotes ?? [],
  };
};

const percent = (rate: number | null): string =>
  rate === null ? '-' : `${(rate * 100).toFixed(1)}%`;

const formatTrialLine = (label: string, summary: TrialSummary): string =>
  `${label} 평균 ${percent(summary.meanRate)} (범위 ${percent(summary.minRate)}~${percent(summary.maxRate)}) · 카드 ${summary.total} · 한 번이라도 ${summary.anyTrial} · 매번 ${summary.everyTrial}`;

// 카드가 없는 쪽은 줄을 내지 않는다 — 잘린 그룹이 없는 실행에서 "잘림 카드 0" 줄이 매번 붙지 않게.
const formatSplitLines = (split: TruncationSplit): string[] => [
  ...(split.intact.total === 0
    ? []
    : [formatTrialLine('  └ diff 안 잘림', split.intact)]),
  ...(split.truncated.total === 0
    ? []
    : [formatTrialLine('  └ diff 잘림', split.truncated)]),
];

const formatBaselineLine = (
  label: string,
  comparison: BaselineComparison,
  note = '',
): string =>
  `기준선 대비 ${label} ${percent(comparison.baselineMean)} → ${percent(comparison.currentMean)} · ${comparison.verdict} (${comparison.reason})${note}`;

// 통과 규칙(docs/superpowers/plans/2026-09-29-review-replay-trials.md §6-2)에서 이 줄이 뜻하는 것.
// 판정 기준인 줄에만 붙인다 — 합친 미탐 값은 참고용이라 붙이지 않는다.
// 표본이 다르면 위에 경고가 나가므로 결론을 안내하지 않는다.
const passRuleNote = (
  comparison: BaselineComparison,
  sameSample: boolean,
): string => {
  if (!sameSample || comparison.verdict === '판단 불가') {
    return '';
  }
  if (comparison.verdict === '변동 범위 안') {
    return ' → 효과 없음 또는 측정 불가';
  }
  if (comparison.direction === '나쁜 쪽') {
    return ' → 나쁜 쪽: 반려';
  }
  return ' → 좋은 쪽: 재실행 1회로 확인, 두 번 다 범위 밖이어야 통과';
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
  const groups: ReplayGroup[] = [];
  for (const row of rows) {
    if (row.status !== 'REJECTED' && row.status !== 'FIXED') {
      continue;
    }
    addToGroup(groups, row, {
      id: row.id,
      label: row.status,
      filePath: row.filePath,
      line: row.line,
      category: row.category,
      body: row.body,
    });
  }
  return groups;
};

// 같은 PR·headSha 면 한 그룹 — 카드와 미탐이 같은 커밋이면 리뷰 한 번으로 함께 잰다.
const addToGroup = (
  groups: ReplayGroup[],
  key: { repo: string; pullNumber: number; headSha: string },
  finding: LabeledFinding,
): void => {
  const found = groups.find(
    (group) =>
      group.repo.toLowerCase() === key.repo.toLowerCase() &&
      group.pullNumber === key.pullNumber &&
      group.headSha === key.headSha,
  );
  if (found !== undefined) {
    found.findings.push(finding);
    return;
  }
  groups.push({
    repo: key.repo,
    pullNumber: key.pullNumber,
    headSha: key.headSha,
    findings: [finding],
  });
};

// 미탐 파일은 모델을 부르기 전에 읽고, 형식이 틀린 항목이 하나라도 있으면 멈춘다.
const readMisses = (path: string): MissedFindingEntry[] => {
  const { entries, errors } = parseMissedFindings(
    JSON.parse(readFileSync(path, 'utf8')),
  );
  if (errors.length > 0) {
    throw new Error(`--misses ${path} 형식 오류:\n${errors.join('\n')}`);
  }
  return entries;
};

// headSha 가 없는 미탐은 그 PR 의 가장 최근 카드 커밋으로 재생한다(한계는 ResolvedMiss 참조).
// 외부 리뷰가 본 커밋과 다를 수 있어 줄 번호가 조금 어긋날 수 있다(매칭 허용 오차 안이면 잡힌다).
const addMisses = async (
  prisma: PrismaService,
  groups: ReplayGroup[],
  misses: readonly MissedFindingEntry[],
): Promise<{ unresolved: MissedFindingEntry[]; resolved: ResolvedMiss[] }> => {
  const unresolved: MissedFindingEntry[] = [];
  const resolved: ResolvedMiss[] = [];
  for (const [index, entry] of misses.entries()) {
    const headSha =
      entry.headSha ??
      (
        await prisma.prReviewFinding.findFirst({
          where: {
            repo: { equals: entry.repo, mode: 'insensitive' },
            pullNumber: entry.pullNumber,
            headSha: { not: '' },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { headSha: true },
        })
      )?.headSha;
    if (headSha === undefined) {
      process.stderr.write(
        `경고: 미탐 ${index}번(${entry.repo}#${entry.pullNumber}) 제외 — 이대리가 리뷰한 커밋을 원장에서 못 찾음\n`,
      );
      unresolved.push(entry);
      continue;
    }
    const labeled = toMissedLabeledFinding(entry);
    resolved.push({
      id: labeled.id,
      repo: entry.repo,
      pullNumber: entry.pullNumber,
      headSha,
      headShaSource: entry.headSha === undefined ? 'latest-card' : 'input',
    });
    addToGroup(
      groups,
      { repo: entry.repo, pullNumber: entry.pullNumber, headSha },
      labeled,
    );
  }
  return { unresolved, resolved };
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
  const common = {
    repo: repository,
    out: readOption('out'),
    // 기본 1회 — 종전 사용법과 쿼터 소비를 바꾸지 않는다.
    trials: readInteger(readOption('trials') ?? '1', 'trials', 1),
    holdout: process.argv.includes('--holdout'),
    baseline: readOption('baseline'),
    misses: readOption('misses'),
    rescore: readOption('rescore'),
  };
  if (ids !== undefined) {
    return { ids, ...common };
  }
  return {
    rejected: readInteger(readOption('rejected') ?? '5', 'rejected', 0),
    fixed: readInteger(readOption('fixed') ?? '5', 'fixed', 0),
    ...common,
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
