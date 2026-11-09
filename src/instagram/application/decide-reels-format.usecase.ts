import { Inject, Injectable } from '@nestjs/common';

import { getKstDateOf, kstDayStartOf } from '../../common/util/kst-date.util';
import {
  buildNextPolicy,
  checkWorstGuard,
  collectSamples,
  decideMode,
  DecisionHistoryRow,
  FormatCandidate,
  judgeExperiment,
  listCandidates,
  planRecovery,
  ReelFormatDecisionMode,
  ReelFormatVerdict,
} from '../domain/format-decision.policy';
import {
  DEFAULT_FORMAT_VALUES,
  FormatKnob,
  FormatPolicy,
} from '../domain/format-policy';
import {
  FORMAT_POLICY_STORE_PORT,
  FormatPolicyStorePort,
} from '../domain/port/format-policy-store.port';
import {
  INSTAGRAM_INSIGHT_SNAPSHOT_REPOSITORY_PORT,
  InstagramInsightSnapshotRepositoryPort,
} from '../domain/port/instagram-insight-snapshot.repository.port';
import {
  INSTAGRAM_POST_REPOSITORY_PORT,
  InstagramPostRepositoryPort,
} from '../domain/port/instagram-post.repository.port';
import {
  REEL_FORMAT_DECISION_REPOSITORY_PORT,
  ReelFormatDecisionInput,
  ReelFormatDecisionRepositoryPort,
} from '../domain/port/reel-format-decision.repository.port';
import {
  REEL_FORMAT_PLANNER_PORT,
  ReelFormatPlannerPort,
} from '../domain/port/reel-format-planner.port';
import { formatReelFormatDecisionReport } from './format-decision-report';

export interface ReelsFormatReport {
  text: string;
  reportedIds: string[];
}
@Injectable()
export class DecideReelsFormatUsecase {
  now = (): Date => new Date();
  constructor(
    @Inject(FORMAT_POLICY_STORE_PORT)
    private readonly store: FormatPolicyStorePort,
    @Inject(REEL_FORMAT_DECISION_REPOSITORY_PORT)
    private readonly decisions: ReelFormatDecisionRepositoryPort,
    @Inject(INSTAGRAM_POST_REPOSITORY_PORT)
    private readonly posts: InstagramPostRepositoryPort,
    @Inject(INSTAGRAM_INSIGHT_SNAPSHOT_REPOSITORY_PORT)
    private readonly snapshots: InstagramInsightSnapshotRepositoryPort,
    @Inject(REEL_FORMAT_PLANNER_PORT)
    private readonly planner: ReelFormatPlannerPort,
  ) {}

  async markReported(ids: string[]): Promise<void> {
    await this.decisions.markReported(ids);
  }

  async execute(): Promise<ReelsFormatReport | null> {
    const now = this.now();
    const today = getKstDateOf(now);
    const rows = await this.decisions.listAll();
    const unreported = rows.filter((row) => row.reportedAt === null);
    const lines = unreported.map(formatReelFormatDecisionReport);
    const reportedIds = unreported.map((row) => row.id);
    const finish = (): ReelsFormatReport | null => {
      if (lines.length === 0) {
        return null;
      }
      return { text: lines.join('\n\n'), reportedIds };
    };
    const state = await this.store.read();
    // 파일을 못 읽는 동안에는 미보고 판정을 싣지 않는다. 파일에 반영됐는지 모르는 "적용" 보고가 완료 처리되면 다시 나가지 않는다.
    if (state.kind === 'no_directory') {
      return {
        text: '릴스 출력 폴더가 없어 형식 정책을 확인하지 못했습니다.',
        reportedIds: [],
      };
    }
    if (state.kind === 'broken') {
      return {
        text: `릴스 형식 정책 오류: ${state.reason}`,
        reportedIds: [],
      };
    }
    const recovered = planRecovery({
      policy: state.kind === 'ok' ? state.policy : null,
      missing: state.kind === 'missing',
      rows,
    });
    let policy: FormatPolicy;
    if (recovered) {
      await this.store.write(recovered);
      policy = recovered;
      lines.push(
        `릴스 형식 정책을 원장에서 v${policy.version}으로 복구했습니다.`,
      );
    } else if (state.kind === 'missing') {
      const base: FormatPolicy = {
        version: 0,
        frozen: false,
        champion: { ...DEFAULT_FORMAT_VALUES },
        experiment: null,
      };
      const candidates = listCandidates({ policy: base, rows });
      policy = buildNextPolicy({
        policy: base,
        verdict: null,
        mode: ReelFormatDecisionMode.PROPOSAL,
        candidate: candidates.candidates[0] ?? null,
        today,
      });
      await this.store.write(policy);
      lines.push(`릴스 형식 정책 v${policy.version}을 초기화했습니다.`);
      return finish();
    } else {
      policy = state.policy;
    }
    if (policy.frozen) {
      return finish();
    }
    const promoted = [...rows]
      .reverse()
      .find(
        (row) =>
          row.verdict === ReelFormatVerdict.PROMOTE &&
          row.mode === ReelFormatDecisionMode.AUTO,
      );
    const startDates = [
      policy.experiment?.start,
      promoted ? getKstDateOf(promoted.decidedAt) : undefined,
    ]
      .filter((day): day is string => day !== undefined)
      .sort();
    const published =
      startDates.length > 0
        ? await this.posts.listPublishedSince(kstDayStartOf(startDates[0]))
        : [];
    const snapshots = await this.snapshots.listByPostIds(
      published.map((post) => post.id),
    );
    const guard = checkWorstGuard({
      policy,
      rows,
      posts: published,
      snapshots,
      today,
      now,
    });
    if (guard?.shouldRevert) {
      const promoted = guard.promoted;
      const knob = promoted.knob as FormatKnob;
      const restored: FormatPolicy = {
        ...policy,
        champion: { ...policy.champion, [knob]: promoted.championValue },
      };
      const candidateList = listCandidates({ policy: restored, rows });
      const proposal = await this.propose(
        JSON.stringify({ guard }),
        candidateList.candidates,
        candidateList.reverseChallenge,
      );
      const after = buildNextPolicy({
        policy: restored,
        verdict: null,
        mode: ReelFormatDecisionMode.AUTO,
        candidate: proposal.candidate,
        today,
      });
      const row: ReelFormatDecisionInput = {
        experimentId: `guard-${promoted.experimentId}`,
        knob,
        championValue: promoted.challengerValue,
        challengerValue: promoted.championValue,
        nChampion: guard.samples.length,
        nChallenger: 0,
        excluded: 0,
        statsJson: {
          championMeanSkip: guard.meanSkip,
          baselineSkip: guard.baselineSkip,
          samples: guard.samples,
          interruptedExperimentId: policy.experiment?.id ?? null,
          nextReverseChallenge: candidateList.reverseChallenge,
        },
        verdict: ReelFormatVerdict.ABORT,
        mode: ReelFormatDecisionMode.AUTO,
        reverseChallenge: false,
        reason: 'worst_guard',
        policyVersionBefore: policy.version,
        policyVersionAfter: after.version,
        policyAfter: after,
        aiProposal: proposal.aiProposal,
        decidedAt: now,
      };
      await this.persist(row, lines, reportedIds);
      return finish();
    }
    if (!policy.experiment) {
      const candidates = listCandidates({ policy, rows });
      if (candidates.candidates.length > 0) {
        const after = buildNextPolicy({
          policy,
          verdict: null,
          mode: ReelFormatDecisionMode.AUTO,
          candidate: candidates.candidates[0],
          today,
        });
        await this.store.write(after);
        lines.push(`릴스 형식 실험 ${after.experiment?.id}을 시작합니다.`);
      }
      // 후보가 없으면 그 사유(사람 확인 필요 포함)는 실험을 끝낸 판정 보고에 이미 실렸다. 매일 다시 보내지 않는다.
      return finish();
    }
    const relevant = published.filter(
      (post) =>
        post.publishedAt !== null &&
        post.publishedAt >= kstDayStartOf(policy.experiment!.start),
    );
    const samples = collectSamples({
      policy,
      posts: relevant,
      snapshots,
      today,
      now,
    });
    const judgment = judgeExperiment({ policy, samples, today });
    if (!judgment.verdict) {
      return finish();
    }
    const experiment = policy.experiment;
    const mode = decideMode(rows);
    const reverseChallenge =
      rows.at(-1)?.statsJson.nextReverseChallenge === true;
    const futureChampion = { ...policy.champion };
    if (
      judgment.verdict === ReelFormatVerdict.PROMOTE &&
      mode === ReelFormatDecisionMode.AUTO
    ) {
      futureChampion[experiment.knob] = experiment.challenger;
    }
    const history: DecisionHistoryRow = {
      experimentId: experiment.id,
      knob: experiment.knob,
      championValue: policy.champion[experiment.knob],
      challengerValue: experiment.challenger,
      verdict: judgment.verdict,
      mode,
      reverseChallenge,
      policyVersionAfter: policy.version + 1,
      policyAfter: policy,
      statsJson: {},
      createdAt: now,
    };
    const candidates = listCandidates({
      policy: { ...policy, champion: futureChampion },
      rows: [...rows, history],
    });
    const proposal = await this.propose(
      JSON.stringify(judgment.stats),
      candidates.candidates,
      candidates.reverseChallenge,
    );
    const after = buildNextPolicy({
      policy,
      verdict: judgment.verdict,
      mode,
      candidate: proposal.candidate,
      today,
    });
    const row: ReelFormatDecisionInput = {
      experimentId: experiment.id,
      knob: experiment.knob,
      championValue: policy.champion[experiment.knob],
      challengerValue: experiment.challenger,
      nChampion: judgment.stats.nChampion,
      nChallenger: judgment.stats.nChallenger,
      excluded: Object.values(judgment.stats.excluded).reduce(
        (sum, count) => sum + count,
        0,
      ),
      statsJson: {
        ...judgment.stats,
        nextReverseChallenge: candidates.reverseChallenge,
        proposalDecisionNumber:
          mode === ReelFormatDecisionMode.PROPOSAL
            ? rows.filter(
                (item) =>
                  !item.experimentId.startsWith('guard-') &&
                  ['PROMOTE', 'KEEP'].includes(item.verdict),
              ).length + 1
            : null,
        needsHumanReview: candidates.needsHumanReview,
      },
      verdict: judgment.verdict,
      mode,
      reverseChallenge,
      reason: judgment.reason,
      policyVersionBefore: policy.version,
      policyVersionAfter: after.version,
      policyAfter: after,
      aiProposal: proposal.aiProposal,
      decidedAt: now,
    };
    await this.persist(row, lines, reportedIds);
    return finish();
  }

  private async persist(
    row: ReelFormatDecisionInput,
    lines: string[],
    ids: string[],
  ): Promise<void> {
    if (!(await this.decisions.insert(row))) {
      return;
    }
    await this.store.write(row.policyAfter);
    const saved = (await this.decisions.listAll()).find(
      (item) => item.experimentId === row.experimentId,
    );
    if (saved) {
      lines.push(formatReelFormatDecisionReport(saved));
      ids.push(saved.id);
    }
  }

  private async propose(
    statsSummary: string,
    candidates: FormatCandidate[],
    reverse: boolean,
  ): Promise<{ candidate: FormatCandidate | null; aiProposal: unknown }> {
    const candidateIds = candidates.map((candidate) => candidate.id);
    try {
      const result = await this.planner.propose({
        statsSummary,
        candidateIds,
        reverseChallenge: reverse,
      });
      if (
        (!reverse &&
          candidateIds.length >= 2 &&
          result.candidateId === undefined) ||
        (result.candidateId !== undefined &&
          !candidateIds.includes(result.candidateId))
      ) {
        throw new Error(
          `후보 밖 제안: ${result.candidateId ?? ''}; raw=${result.raw}`,
        );
      }
      const candidate = reverse
        ? (candidates[0] ?? null)
        : (candidates.find((item) => item.id === result.candidateId) ??
          candidates[0] ??
          null);
      return { candidate, aiProposal: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        candidate: candidates[0] ?? null,
        aiProposal: { error: message },
      };
    }
  }
}
