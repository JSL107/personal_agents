import { Inject, Injectable } from '@nestjs/common';

import { getKstDateOf, kstDayStartOf } from '../../common/util/kst-date.util';
import {
  buildNextPolicy,
  CandidateList,
  checkWorstGuard,
  collectSamples,
  countConclusiveDecisions,
  decideMode,
  DecisionOutcome,
  findActivePromotion,
  FormatCandidate,
  judgeExperiment,
  JudgeResult,
  listCandidates,
  nextChampion,
  planRecovery,
  PromotionDecision,
  ReelFormatDecisionMode,
  ReelFormatDecisionReason,
  ReelFormatVerdict,
  WorstGuardResult,
} from '../domain/format-decision.policy';
import {
  DEFAULT_FORMAT_VALUES,
  FormatExperiment,
  FormatPolicy,
} from '../domain/format-policy';
import { ReelFormatLedgerCorruptedException } from '../domain/instagram.exception';
import { InsightSnapshot } from '../domain/instagram-insight.type';
import { InstagramPost } from '../domain/instagram-post.type';
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
  ReelFormatAiProposal,
  ReelFormatDecision,
  ReelFormatDecisionInput,
  ReelFormatDecisionRepositoryPort,
} from '../domain/port/reel-format-decision.repository.port';
import {
  PlannerProposal,
  PlannerProposalInput,
  REEL_FORMAT_PLANNER_PORT,
  ReelFormatPlannerPort,
} from '../domain/port/reel-format-planner.port';
import { formatReelFormatDecisionReport } from './format-decision-report';

export interface ReelsFormatReport {
  text: string;
  reportedIds: string[];
}
interface RunContext {
  rows: ReelFormatDecision[];
  lines: string[];
  reportedIds: string[];
  today: string;
  now: Date;
}
interface PolicyResolution {
  policy: FormatPolicy;
  initialized: boolean;
}
type AvailablePolicyRead =
  | { kind: 'missing' }
  | { kind: 'ok'; policy: FormatPolicy };
interface ProposeParameters {
  statsSummary: string;
  candidates: FormatCandidate[];
  reverseChallenge: boolean;
}
interface ProposalChoice {
  candidate: FormatCandidate | null;
  aiProposal: ReelFormatAiProposal;
}
interface DecisionEvidence {
  posts: InstagramPost[];
  snapshots: InsightSnapshot[];
}
interface PlannerFailure {
  error: string;
}
interface ConclusiveJudgment extends JudgeResult {
  verdict: ReelFormatVerdict;
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
    try {
      return await this.executeDecision();
    } catch (error) {
      if (error instanceof ReelFormatLedgerCorruptedException) {
        return {
          text: `릴스 형식 판정 원장이 손상되어 자동 판정을 멈췄습니다: ${error.ids.join(', ')}`,
          reportedIds: [],
        };
      }
      throw error;
    }
  }

  private async executeDecision(): Promise<ReelsFormatReport | null> {
    const rows = await this.decisions.listAll();
    const now = this.now();
    const context = this.collectUnreported({ rows, now });
    const state = await this.store.read();
    if (state.kind === 'no_directory') {
      return {
        text: '릴스 출력 폴더가 없어 형식 정책을 확인하지 못했습니다.',
        reportedIds: [],
      };
    }
    if (state.kind === 'broken') {
      return { text: `릴스 형식 정책 오류: ${state.reason}`, reportedIds: [] };
    }
    const resolution = await this.resolvePolicy({ state, context });
    if (!resolution.initialized && !resolution.policy.frozen) {
      await this.decide({ policy: resolution.policy, context });
    }
    return this.finish(context);
  }

  private collectUnreported({
    rows,
    now,
  }: {
    rows: ReelFormatDecision[];
    now: Date;
  }): RunContext {
    const unreported = rows.filter((row) => row.reportedAt === null);
    return {
      rows,
      lines: unreported.map(formatReelFormatDecisionReport),
      reportedIds: unreported.map((row) => row.id),
      today: getKstDateOf(now),
      now,
    };
  }

  private finish(context: RunContext): ReelsFormatReport | null {
    if (context.lines.length === 0) {
      return null;
    }
    return {
      text: context.lines.join('\n\n'),
      reportedIds: context.reportedIds,
    };
  }

  private async resolvePolicy({
    state,
    context,
  }: {
    state: AvailablePolicyRead;
    context: RunContext;
  }): Promise<PolicyResolution> {
    const recovered = planRecovery({
      state,
      latest: context.rows.at(-1) ?? null,
    });
    if (recovered) {
      const previous = state.kind === 'ok' ? state.policy : null;
      await this.store.write({ policy: recovered, previous });
      context.lines.push(
        `릴스 형식 정책을 원장에서 v${recovered.version}으로 복구했습니다.`,
      );
      return { policy: recovered, initialized: false };
    }
    if (state.kind === 'ok') {
      return { policy: state.policy, initialized: false };
    }
    const base: FormatPolicy = {
      version: 0,
      frozen: false,
      champion: { ...DEFAULT_FORMAT_VALUES },
      experiment: null,
    };
    const candidates = listCandidates({ policy: base, rows: context.rows });
    const policy = buildNextPolicy({
      policy: base,
      verdict: null,
      mode: ReelFormatDecisionMode.PROPOSAL,
      candidate: candidates.candidates[0] ?? null,
      today: context.today,
    });
    await this.store.write({ policy, previous: null });
    context.lines.push(`릴스 형식 정책 v${policy.version}을 초기화했습니다.`);
    return { policy, initialized: true };
  }

  private async decide({
    policy,
    context,
  }: {
    policy: FormatPolicy;
    context: RunContext;
  }): Promise<void> {
    const promotion = findActivePromotion({ policy, rows: context.rows });
    const { posts, snapshots } = await this.loadEvidence({ policy, promotion });
    const guard = promotion
      ? checkWorstGuard({
          promotion,
          posts,
          snapshots,
          today: context.today,
          now: context.now,
        })
      : null;
    if (guard?.shouldRevert) {
      await this.revertByWorstGuard({ policy, context, guard });
      return;
    }
    if (!policy.experiment) {
      await this.startNextExperiment({ policy, context });
      return;
    }
    const samples = collectSamples({
      policy,
      posts,
      snapshots,
      today: context.today,
      now: context.now,
    });
    const judgment = judgeExperiment({ policy, samples, today: context.today });
    if (judgment.verdict) {
      await this.recordJudgment({
        policy,
        experiment: policy.experiment,
        context,
        judgment: { ...judgment, verdict: judgment.verdict },
      });
    }
  }

  private async loadEvidence({
    policy,
    promotion,
  }: {
    policy: FormatPolicy;
    promotion: PromotionDecision | null;
  }): Promise<DecisionEvidence> {
    const startDates = [
      policy.experiment?.start,
      promotion ? getKstDateOf(promotion.decidedAt) : undefined,
    ]
      .filter((day): day is string => day !== undefined)
      .sort();
    const start = startDates[0];
    const posts = start
      ? await this.posts.listPublishedSince(kstDayStartOf(start))
      : [];
    const snapshots = start
      ? await this.snapshots.listByPostIds(posts.map((post) => post.id))
      : [];
    return { posts, snapshots };
  }

  private async startNextExperiment({
    policy,
    context,
  }: {
    policy: FormatPolicy;
    context: RunContext;
  }): Promise<void> {
    const candidates = listCandidates({ policy, rows: context.rows });
    const candidate = candidates.candidates[0];
    if (!candidate) {
      return;
    }
    const after = buildNextPolicy({
      policy,
      verdict: null,
      mode: ReelFormatDecisionMode.AUTO,
      candidate,
      today: context.today,
    });
    await this.store.write({ policy: after, previous: policy });
    context.lines.push(`릴스 형식 실험 ${after.experiment?.id}을 시작합니다.`);
  }

  private async revertByWorstGuard({
    policy,
    context,
    guard,
  }: {
    policy: FormatPolicy;
    context: RunContext;
    guard: WorstGuardResult;
  }): Promise<void> {
    const promoted = guard.promoted;
    const knob = promoted.knob;
    const restored: FormatPolicy = {
      ...policy,
      champion: { ...policy.champion, [knob]: promoted.championValue },
    };
    const candidates = listCandidates({ policy: restored, rows: context.rows });
    const proposal = await this.propose({
      statsSummary: JSON.stringify({
        meanSkip: guard.meanSkip,
        baselineSkip: guard.baselineSkip,
        n: guard.samples.length,
        verdict: ReelFormatVerdict.ABORT,
        reason: ReelFormatDecisionReason.WORST_GUARD,
      }),
      candidates: candidates.candidates,
      reverseChallenge: candidates.reverseChallenge,
    });
    const after = buildNextPolicy({
      policy: restored,
      verdict: null,
      mode: ReelFormatDecisionMode.AUTO,
      candidate: proposal.candidate,
      today: context.today,
    });
    const row = this.buildGuardRow({
      policy,
      context,
      guard,
      candidates,
      proposal,
      after,
    });
    await this.persist({ row, previous: policy, context });
  }

  private buildGuardRow({
    policy,
    context,
    guard,
    candidates,
    proposal,
    after,
  }: {
    policy: FormatPolicy;
    context: RunContext;
    guard: WorstGuardResult;
    candidates: CandidateList;
    proposal: ProposalChoice;
    after: FormatPolicy;
  }): ReelFormatDecisionInput {
    const promoted = guard.promoted;
    return {
      experimentId: `guard-${promoted.experimentId}`,
      knob: promoted.knob,
      championValue: promoted.challengerValue,
      challengerValue: promoted.championValue,
      nChampion: guard.samples.length,
      nChallenger: 0,
      excluded: 0,
      statsJson: {
        kind: 'guard',
        meanSkip: guard.meanSkip,
        baselineSkip: guard.baselineSkip,
        samples: guard.samples,
        interruptedExperimentId: policy.experiment?.id ?? null,
        nextReverseChallenge: candidates.reverseChallenge,
        needsHumanReview: candidates.needsHumanReview,
      },
      verdict: ReelFormatVerdict.ABORT,
      mode: ReelFormatDecisionMode.AUTO,
      reverseChallenge: false,
      reason: ReelFormatDecisionReason.WORST_GUARD,
      policyVersionBefore: policy.version,
      policyVersionAfter: after.version,
      policyAfter: after,
      aiProposal: proposal.aiProposal,
      decidedAt: context.now,
    };
  }

  private async recordJudgment({
    policy,
    experiment,
    context,
    judgment,
  }: {
    policy: FormatPolicy;
    experiment: FormatExperiment;
    context: RunContext;
    judgment: ConclusiveJudgment;
  }): Promise<void> {
    const mode = decideMode(context.rows);
    const reverseChallenge =
      context.rows.at(-1)?.statsJson.nextReverseChallenge ?? false;
    const outcome: DecisionOutcome = {
      experimentId: experiment.id,
      knob: experiment.knob,
      championValue: policy.champion[experiment.knob],
      challengerValue: experiment.challenger,
      verdict: judgment.verdict,
      mode,
      reverseChallenge,
    };
    const champion = nextChampion({ policy, verdict: judgment.verdict, mode });
    const candidates = listCandidates({
      policy: { ...policy, champion },
      rows: [...context.rows, outcome],
    });
    const proposal = await this.propose({
      statsSummary: this.summarizeJudgment(judgment),
      candidates: candidates.candidates,
      reverseChallenge: candidates.reverseChallenge,
    });
    const after = buildNextPolicy({
      policy,
      verdict: judgment.verdict,
      mode,
      candidate: proposal.candidate,
      today: context.today,
    });
    const row = this.buildJudgmentRow({
      policy,
      context,
      judgment,
      outcome,
      candidates,
      proposal,
      after,
    });
    await this.persist({ row, previous: policy, context });
  }

  private summarizeJudgment(judgment: ConclusiveJudgment): string {
    const { stats } = judgment;
    return JSON.stringify({
      nChampion: stats.nChampion,
      nChallenger: stats.nChallenger,
      championMeanSkip: stats.championMeanSkip,
      challengerMeanSkip: stats.challengerMeanSkip,
      championMeanWatchMs: stats.championMeanWatchMs,
      challengerMeanWatchMs: stats.challengerMeanWatchMs,
      skipDifference: stats.skipDifference,
      pValue: stats.pValue,
      excluded: stats.excluded,
      publishRates: stats.publishRates,
      verdict: judgment.verdict,
      reason: judgment.reason,
    });
  }

  private buildJudgmentRow({
    policy,
    context,
    judgment,
    outcome,
    candidates,
    proposal,
    after,
  }: {
    policy: FormatPolicy;
    context: RunContext;
    judgment: ConclusiveJudgment;
    outcome: DecisionOutcome;
    candidates: CandidateList;
    proposal: ProposalChoice;
    after: FormatPolicy;
  }): ReelFormatDecisionInput {
    const proposalDecisionNumber =
      outcome.mode === ReelFormatDecisionMode.PROPOSAL
        ? countConclusiveDecisions(context.rows) + 1
        : null;
    const excluded = Object.values(judgment.stats.excluded).reduce(
      (sum, count) => sum + count,
      0,
    );
    return {
      ...outcome,
      nChampion: judgment.stats.nChampion,
      nChallenger: judgment.stats.nChallenger,
      excluded,
      statsJson: {
        kind: 'judgment',
        ...judgment.stats,
        nextReverseChallenge: candidates.reverseChallenge,
        proposalDecisionNumber,
        needsHumanReview: candidates.needsHumanReview,
      },
      reason: judgment.reason,
      policyVersionBefore: policy.version,
      policyVersionAfter: after.version,
      policyAfter: after,
      aiProposal: proposal.aiProposal,
      decidedAt: context.now,
    };
  }

  private async persist({
    row,
    previous,
    context,
  }: {
    row: ReelFormatDecisionInput;
    previous: FormatPolicy;
    context: RunContext;
  }): Promise<void> {
    const saved = await this.decisions.insert(row);
    if (!saved) {
      return;
    }
    await this.store.write({ policy: row.policyAfter, previous });
    context.lines.push(formatReelFormatDecisionReport(saved));
    context.reportedIds.push(saved.id);
  }

  private async propose({
    statsSummary,
    candidates,
    reverseChallenge,
  }: ProposeParameters): Promise<ProposalChoice> {
    const candidateIds = candidates.map((candidate) => candidate.id);
    const fallback = candidates[0] ?? null;
    const plannerProposal = await this.callPlanner({
      statsSummary,
      candidateIds,
      reverseChallenge,
    });
    if ('error' in plannerProposal) {
      return { candidate: fallback, aiProposal: plannerProposal };
    }
    const chosen = candidates.find(
      (candidate) => candidate.id === plannerProposal.candidateId,
    );
    const invalid =
      (plannerProposal.candidateId !== undefined && !chosen) ||
      (!reverseChallenge &&
        candidateIds.length >= 2 &&
        plannerProposal.candidateId === undefined);
    if (invalid) {
      return {
        candidate: fallback,
        aiProposal: {
          error: `후보 밖 제안: ${plannerProposal.candidateId ?? ''}; raw=${plannerProposal.raw}`,
        },
      };
    }
    const candidate = reverseChallenge ? fallback : (chosen ?? fallback);
    return { candidate, aiProposal: plannerProposal };
  }

  // AI 실패는 판정을 막지 않는다. 오류는 원장 aiProposal 에 남기고 대기열 순서로 간다.
  private async callPlanner(
    input: PlannerProposalInput,
  ): Promise<PlannerProposal | PlannerFailure> {
    try {
      return await this.planner.propose(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: message };
    }
  }
}
