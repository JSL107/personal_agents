import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { wrapUntrustedInput } from '../../../common/llm/untrusted-input.util';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { coerceToDailyPlan } from '../../pm/domain/prompt/previous-plan-formatter';
import { buildFindingReferences } from '../domain/finding-reference';
import {
  buildFindingRecoveryFacts,
  buildPlanRealityFacts,
  carryForwardPriorFindings,
  collectSelfAuthoredKeys,
  DEGRADED_PRIOR_REPORT,
  DEGRADED_UNCOMPARABLE,
  extractPriorFindingKeys,
  FactSource,
  FindingRecoveryResult,
  findNovelFactIds,
  hasPlanRealityMismatch,
  PlanRealityFact,
  PriorFinding,
  readReportedFactStates,
  RecoveryLifecycle,
  toReportedFactStates,
  withdrawStalledReasons,
} from '../domain/plan-reality.diff';
import { PoShadowException } from '../domain/po-shadow.exception';
import { guardPoShadowReport } from '../domain/po-shadow.guard';
import {
  GeneratePoShadowInput,
  PoShadowContext,
  PoShadowFinding,
  PoShadowRecoverySummary,
  PoShadowReport,
  ReportedFactState,
} from '../domain/po-shadow.type';
import { PoShadowErrorCode } from '../domain/po-shadow-error-code.enum';
import {
  PRODUCT_GOAL_REPOSITORY_PORT,
  ProductGoalRepositoryPort,
} from '../domain/port/product-goal.repository.port';
import { ProductGoalRecord } from '../domain/product-goal';
import {
  buildProductGoalFacts,
  ProductGoalFactsResult,
} from '../domain/product-goal.facts';
import { parsePoShadowReport } from '../domain/prompt/po-shadow.parser';
import { PO_SHADOW_OUTPUT_SCHEMA } from '../domain/prompt/po-shadow.schema';
import { collectStoredFactIds } from '../domain/prompt/po-shadow-report.coercer';
import { PO_SHADOW_SYSTEM_PROMPT } from '../domain/prompt/po-shadow-system.prompt';
import {
  DEGRADED_SOURCE_LABEL,
  PoShadowContextCollector,
} from './po-shadow-context.collector';

const STALENESS_THRESHOLD_MS = 18 * 60 * 60 * 1000;
// 회수 대상을 찾는 원장 조회 창. 실측(2026-09-10) 상 지적 키의 최장 지속이 17일이라 30일이면
// 모든 키의 firstReportedAt 을 보존한다.
const RECOVERY_LOOKBACK_DAYS = 30;
const RECOVERY_LOOKBACK_LIMIT = 40;
// 제품 목표 조회가 실패한 회차의 열화 라벨. 목표가 없는 것과 못 본 것은
// 글자가 달라야 한다 — 같으면 "목표 밖 작업 없음" 이 실은 "목표를 못 읽음" 인 회차를 가린다.
const DEGRADED_PRODUCT_GOAL = '제품 목표';

interface ProductGoalCollection extends ProductGoalFactsResult {
  goals: ProductGoalRecord[];
  degraded: boolean;
}

@Injectable()
export class GeneratePoShadowUsecase {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly contextCollector: PoShadowContextCollector,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    @Inject(PRODUCT_GOAL_REPOSITORY_PORT)
    private readonly goalRepository: ProductGoalRepositoryPort,
  ) {}

  private readonly logger = new Logger(GeneratePoShadowUsecase.name);

  async execute({
    extraContext,
    slackUserId,
    triggerType,
    enforcePlanFreshness,
    now = new Date(),
  }: GeneratePoShadowInput): Promise<AgentRunOutcome<PoShadowReport>> {
    const snapshot = await this.agentRunService.findLatestSucceededRun({
      agentType: AgentType.PM,
      slackUserId,
    });
    if (!snapshot) {
      throw new PoShadowException({
        code: PoShadowErrorCode.NO_RECENT_PLAN,
        message:
          '검토할 직전 PM 실행이 없습니다. 먼저 `/today` 로 plan 을 생성한 뒤 다시 시도해주세요.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    const planAgeMilliseconds = now.getTime() - snapshot.endedAt.getTime();
    if (
      enforcePlanFreshness === true &&
      planAgeMilliseconds > STALENESS_THRESHOLD_MS
    ) {
      throw new PoShadowException({
        code: PoShadowErrorCode.STALE_PLAN,
        message: `직전 PM plan이 ${Math.round(planAgeMilliseconds / 3_600_000)}시간 전입니다. 최신 plan이 없어 PO Shadow 자동 검토를 건너뜁니다.`,
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    const plan = coerceToDailyPlan(snapshot.output);
    if (!plan) {
      throw new PoShadowException({
        code: PoShadowErrorCode.NO_RECENT_PLAN,
        message:
          '직전 PM 실행 결과를 DailyPlan 으로 해석할 수 없습니다 (구버전 출력). 새로운 `/today` 실행 후 다시 시도해주세요.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }

    const trimmedExtra = extraContext.trim();
    const context = await this.contextCollector.collect({
      slackUserId,
      planEndedAt: snapshot.endedAt,
    });
    const planFacts = buildPlanRealityFacts(plan, context);
    const previousReportedFacts = await this.loadPreviousReportedFacts({
      slackUserId,
    });
    const recovery = await this.recoverPriorFindings({
      slackUserId,
      context,
      now,
      previousReportedFacts,
    });
    // 활성 숙제가 0개면 사실·프롬프트 블록·inputSnapshot 키를 하나도 만들지 않는다 —
    // 방향만 있는 회차도 목표를 쓰지 않는 회차와 같아야 한다.
    const goalCollection = await this.collectProductGoals({
      slackUserId,
      context,
      now,
    });
    const facts = [
      ...withdrawStalledReasons(planFacts, recovery.reasonWithdrawnKeys),
      ...recovery.facts,
      ...goalCollection.facts,
    ];
    const degradedSources = goalCollection.degraded
      ? [...recovery.degradedSources, DEGRADED_PRODUCT_GOAL]
      : recovery.degradedSources;
    const recoverySummary = toRecoverySummary(recovery);
    // 사용자가 "릴리즈 오늘로 변경" 같은 상황을 직접 적어 보냈다면 사실표가 조용해도 검토한다.
    // 어긋남만으로 갈림길을 정하면 사용자가 친 말이 evidence 에만 저장되고 답은
    // "계획대로 진행 중" 으로 나간다.
    const novelFactIds = findNovelFactIds(facts, previousReportedFacts);
    const needsReview =
      hasPlanRealityMismatch(facts, novelFactIds) || trimmedExtra.length > 0;
    // 모델이 지적으로 인용할 수 있는 사실. 이미 알린 사실은 맥락으로만 보여 주고 인용은 코드가 막는다
    // — 프롬프트로만 막으면 지켜진 회차에만 지켜진다. 사용자가 직접 상황을 적어 보낸 회차는 그 말에
    // 답해야 하므로 이미 알린 사실도 인용을 허용한다. 본인이 연 항목은 어느 경우에도 지적 대상이 아니다.
    const citableFacts = facts.filter(
      (fact) =>
        fact.kind !== 'UNPLANNED_SELF_AUTHORED' &&
        (trimmedExtra.length > 0 || novelFactIds.has(fact.id)),
    );

    return this.agentRunService.execute({
      agentType: AgentType.PO_SHADOW,
      triggerType: triggerType ?? TriggerType.SLACK_COMMAND_PO_SHADOW,
      // 대조 대상인 PM 계획 — 없으면 위에서 NO_RECENT_PLAN 으로 끊기므로 늘 있다.
      participants: [AgentType.PM],
      inputSnapshot: {
        slackUserId,
        sourcePlanAgentRunId: snapshot.id,
        sourcePlanEndedAt: snapshot.endedAt.toISOString(),
        extraContextLength: trimmedExtra.length,
      },
      evidence: [
        {
          sourceType: 'PRIOR_DAILY_PLAN',
          sourceId: String(snapshot.id),
          payload: { plan, endedAt: snapshot.endedAt.toISOString() },
        },
        {
          sourceType: 'PO_SHADOW_FACT_TABLE',
          sourceId: String(snapshot.id),
          payload: facts,
        },
        ...(trimmedExtra.length > 0
          ? [
              {
                sourceType: 'SLACK_COMMAND_PO_SHADOW' as const,
                sourceId: slackUserId,
                payload: { extraContext: trimmedExtra },
              },
            ]
          : []),
      ],
      run: async () => {
        // 다음 회차가 "새로 바뀐 사실" 과 미이동 나이를 가르는 기준(`readReportedFactStates`).
        // 모델 결과를 본 뒤에야 무엇이 실제로 전달됐는지 알 수 있어 inputSnapshot 이 아니라 리포트에 싣는다.
        const reportStates = (undeliveredFactIds: Set<string>) =>
          toReportedFactStates(facts, {
            undeliveredFactIds,
            previousStates: previousReportedFacts,
            degradedFactSources: collectDegradedFactSources({
              context,
              recoveryDegradedSources: recovery.degradedSources,
              goalDegraded: goalCollection.degraded,
            }),
          });
        if (!needsReview) {
          const report: PoShadowReport = {
            ...buildQuietReport({
              facts,
              degradedSources,
              recoverySummary,
            }),
            reportedFacts: reportStates(new Set()),
          };
          return {
            result: report,
            modelUsed: 'deterministic',
            output: report,
          };
        }
        const prompt = buildPrompt({
          planJson: JSON.stringify(plan, null, 2),
          planEndedAt: snapshot.endedAt.toISOString(),
          planAgentRunId: snapshot.id,
          citableFacts,
          contextFacts: facts.filter((fact) => !citableFacts.includes(fact)),
          extraContext: trimmedExtra,
          goals: goalCollection.goals,
        });
        const completion = await this.modelRouter.route({
          agentType: AgentType.PO_SHADOW,
          request: {
            prompt,
            systemPrompt: PO_SHADOW_SYSTEM_PROMPT,
            outputSchema: PO_SHADOW_OUTPUT_SCHEMA,
          },
        });
        const parsedReport = parsePoShadowReport(completion.text);
        const guardedReport = buildGuardedReport({
          report: parsedReport,
          facts: citableFacts,
          degradedSources,
          recoverySummary,
        });
        const report: PoShadowReport = {
          ...guardedReport,
          findingReferences: buildFindingReferences(
            guardedReport.findings,
            facts,
            buildGithubTitleByKey(context),
          ),
          // 근거가 남은 지적이 하나도 없으면 새 사실은 대표에게 전달되지 않았다 — 다음 회차에 다시 띄운다.
          // 모델이 3건 한도로 일부만 고른 것은 우선순위 판단이므로 전달된 것으로 본다(인용 안 한 사실까지
          // 매일 다시 켜면 같은 사실이 매일 검토를 켜던 원래 문제로 돌아간다).
          reportedFacts: reportStates(
            guardedReport.findings.length === 0 ? novelFactIds : new Set(),
          ),
        };
        return {
          result: report,
          modelUsed: completion.modelUsed,
          output: report,
        };
      },
    });
  }

  private async collectProductGoals({
    slackUserId,
    context,
    now,
  }: {
    slackUserId: string;
    context: PoShadowContext;
    now: Date;
  }): Promise<ProductGoalCollection> {
    const empty: ProductGoalCollection = {
      goals: [],
      facts: [],
      degraded: false,
    };
    let goals: ProductGoalRecord[];
    try {
      const activeGoals = await this.goalRepository.findActive(slackUserId);
      // 방향은 키워드가 없어 사실표에 넣으면 모든 PR 이 GOAL_UNSERVED 가 된다.
      // 방향만 있으면 목표 없는 회차와 같아야 한다.
      goals = activeGoals.filter((goal) => goal.kind === 'TASK');
    } catch (error: unknown) {
      this.logger.warn(
        `제품 목표 조회 실패 (목표 없이 계속 진행): ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ...empty, degraded: true };
    }
    if (goals.length === 0) {
      return empty;
    }

    return {
      goals,
      degraded: false,
      ...buildProductGoalFacts({ goals, context, now }),
    };
  }

  // 직전 PO 회차가 남긴 사실 상태. 조회가 실패하면 null(비교 기준 없음)로 두어 모든 사실을 새 것으로
  // 본다 — 이 기능이 생기기 전과 같은 동작이라, 조회 실패가 지적을 삼키는 쪽으로 가지 않는다.
  private async loadPreviousReportedFacts({
    slackUserId,
  }: {
    slackUserId: string;
  }): Promise<ReportedFactState[] | null> {
    try {
      const previousRun = await this.agentRunService.findLatestSucceededRun({
        agentType: AgentType.PO_SHADOW,
        slackUserId,
      });
      return previousRun === null
        ? null
        : readReportedFactStates(previousRun.output);
    } catch (error: unknown) {
      this.logger.warn(
        `직전 PO 사실 상태 조회 실패 (모든 사실을 새 것으로 보고 진행): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  // 직전 회차들이 지적한 키가 어떻게 끝났는지 회수한다. 원장 조회 1회 + 담당 목록에 없는 키에
  // 대해서만 GitHub 단건 조회(실측상 하루 한 자릿수)를 돈다.
  private async recoverPriorFindings({
    slackUserId,
    context,
    now,
    previousReportedFacts,
  }: {
    slackUserId: string;
    context: PoShadowContext;
    now: Date;
    previousReportedFacts: ReportedFactState[] | null;
  }): Promise<FindingRecoveryResult & { degradedSources: string[] }> {
    const degradedSources = [...context.degradedSources];
    const empty: FindingRecoveryResult = {
      facts: [],
      movementTally: { merged: 0, unresolved: 0, abandoned: 0, unassigned: 0 },
      uncomparableCount: 0,
      totalPriorKeys: 0,
      reasonWithdrawnKeys: [],
      assignedLookupFailed: false,
    };

    let priorFindings: PriorFinding[];
    let malformedRunCount = 0;
    try {
      const runs = await this.agentRunService.findRecentSucceededRuns({
        agentType: AgentType.PO_SHADOW,
        slackUserId,
        sinceDays: RECOVERY_LOOKBACK_DAYS,
        limit: RECOVERY_LOOKBACK_LIMIT,
      });
      const parsedRuns = runs.map((run) => ({
        factIds: collectStoredFactIds(run.output),
        endedAt: run.endedAt,
      }));
      malformedRunCount = parsedRuns.filter(
        (run) => run.factIds === null,
      ).length;
      priorFindings = carryForwardPriorFindings(
        extractPriorFindingKeys(
          parsedRuns.map((run) => ({
            factIds: run.factIds ?? [],
            endedAt: run.endedAt,
          })),
          collectSelfAuthoredKeys(context),
        ),
        previousReportedFacts,
      );
    } catch (error: unknown) {
      // 조회·해석 실패를 "지적 없음" 과 같은 빈 배열로 두면 미해결 항목이 조용히 사라진다.
      this.logger.warn(
        `직전 PO 보고 회수 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        ...empty,
        degradedSources: [...degradedSources, DEGRADED_PRIOR_REPORT],
      };
    }

    if (malformedRunCount > 0) {
      // 조회는 됐지만 저장 형태가 깨진 회차. 예외가 아니라 catch 에 안 걸리므로 여기서 센다.
      this.logger.warn(
        `직전 PO 보고 ${malformedRunCount}건 해석 실패 — 회수 대상에서 빠짐`,
      );
      degradedSources.push(DEGRADED_PRIOR_REPORT);
    }

    if (priorFindings.length === 0) {
      return { ...empty, degradedSources };
    }

    const lifecycles = await this.fetchLifecycles({ priorFindings, context });
    const recovery = buildFindingRecoveryFacts({
      priorFindings,
      context,
      lifecycles,
      now,
    });

    // 직전 지적이 있었는데 한 건도 대조하지 못했다면 카드에 흔적을 남긴다 — 그래야
    // 키 추출·조회 버그가 "회수할 것이 없었다" 와 구별된다.
    const allUncomparable =
      !recovery.assignedLookupFailed &&
      recovery.uncomparableCount > 0 &&
      recovery.uncomparableCount === recovery.totalPriorKeys;

    return {
      ...recovery,
      degradedSources: allUncomparable
        ? [...degradedSources, DEGRADED_UNCOMPARABLE]
        : degradedSources,
    };
  }

  // 담당 목록에 없는 키만 단건 조회한다. 실패는 그 키에만 가둔다(다른 키에 전파하지 않는다).
  private async fetchLifecycles({
    priorFindings,
    context,
  }: {
    priorFindings: PriorFinding[];
    context: PoShadowContext;
  }): Promise<Map<string, RecoveryLifecycle | null>> {
    const lifecycles = new Map<string, RecoveryLifecycle | null>();
    if (context.assignedTasks === null) {
      return lifecycles;
    }
    const assignedKeys = new Set([
      ...context.assignedTasks.issues.map(
        (issue) => `${issue.repo}#${issue.number}`,
      ),
      ...context.assignedTasks.pullRequests.map(
        (pullRequest) => `${pullRequest.repo}#${pullRequest.number}`,
      ),
    ]);

    for (const prior of priorFindings) {
      if (assignedKeys.has(prior.key)) {
        continue;
      }
      const [repo, rawNumber] = prior.key.split('#');
      const number = Number(rawNumber);
      if (!repo || !Number.isSafeInteger(number)) {
        lifecycles.set(prior.key, null);
        continue;
      }
      try {
        lifecycles.set(
          prior.key,
          await this.githubClient.getItemLifecycle({ repo, number }),
        );
      } catch {
        // 이슈 번호(PR 아님)거나 권한·네트워크 실패. 그 키만 대조 불가로 센다.
        lifecycles.set(prior.key, null);
      }
    }
    return lifecycles;
  }
}

// 지난 지적 사실은 제목이 없어 이번 회차 조회 결과에서 `owner/repo#N` 으로 찾는다.
const buildGithubTitleByKey = (context: PoShadowContext): Map<string, string> =>
  new Map(
    [
      ...(context.assignedTasks?.issues ?? []),
      ...(context.assignedTasks?.pullRequests ?? []),
      ...context.activePullRequests,
      ...context.mergedPullRequests,
    ].map((item) => [`${item.repo}#${item.number}`, item.title]),
  );

// 이번 회차에 조회가 실패해 사실을 만들지 못한 출처. 멘션은 id 가 메시지마다 달라 이어 둘 상태가 없다.
const collectDegradedFactSources = ({
  context,
  recoveryDegradedSources,
  goalDegraded,
}: {
  context: PoShadowContext;
  recoveryDegradedSources: string[];
  goalDegraded: boolean;
}): FactSource[] => {
  const sources: FactSource[] = [];
  if (context.assignedTasks === null) {
    sources.push('GITHUB_ASSIGNED');
  }
  if (!context.mergedLookupAvailable) {
    sources.push('GITHUB_MERGED');
  }
  if (context.degradedSources.includes(DEGRADED_SOURCE_LABEL.ENGAGEMENT)) {
    sources.push('PR_ENGAGEMENT');
  }
  if (
    recoveryDegradedSources.includes(DEGRADED_PRIOR_REPORT) ||
    recoveryDegradedSources.includes(DEGRADED_UNCOMPARABLE)
  ) {
    sources.push('PRIOR_REPORT');
  }
  if (goalDegraded) {
    sources.push('PRODUCT_GOAL');
  }
  return sources;
};

interface BuildQuietReportInput {
  facts: PlanRealityFact[];
  degradedSources: string[];
  recoverySummary: PoShadowRecoverySummary | null;
}

const buildQuietReport = ({
  facts,
  degradedSources,
  recoverySummary,
}: BuildQuietReportInput): PoShadowReport => ({
  schemaVersion: 2,
  quiet: true,
  headline: '계획대로 진행 중',
  findings: [],
  judgments: [],
  factSummary: facts.map(buildFactSummary),
  droppedFindingCount: 0,
  degradedSources,
  recoverySummary,
});

interface BuildGuardedReportInput {
  report: PoShadowReport;
  facts: PlanRealityFact[];
  degradedSources: string[];
  recoverySummary: PoShadowRecoverySummary | null;
}

const buildGuardedReport = ({
  report,
  facts,
  degradedSources,
  recoverySummary,
}: BuildGuardedReportInput): PoShadowReport => {
  const guardedReport = guardPoShadowReport(
    {
      ...report,
      schemaVersion: 2,
      quiet: false,
      factSummary: [],
      droppedFindingCount: 0,
      degradedSources,
      recoverySummary,
    },
    facts,
  );
  // 판단만 담은 보고(finding 0 + judgments)에는 사실표 전체를 싣지 않는다 —
  // 두 줄짜리 보고가 사실표 길이만큼 근거 줄을 달고 나가는 것을 막는다.
  const judgmentOnly =
    guardedReport.findings.length === 0 && guardedReport.judgments.length > 0;
  const factSummary = judgmentOnly
    ? []
    : buildFindingFactSummaries({
        findings: guardedReport.findings,
        facts,
      });
  return { ...guardedReport, factSummary };
};

interface BuildFindingFactSummariesInput {
  findings: PoShadowFinding[];
  facts: PlanRealityFact[];
}

const buildFindingFactSummaries = ({
  findings,
  facts,
}: BuildFindingFactSummariesInput): string[] => {
  if (findings.length === 0) {
    return facts.map(buildFactSummary);
  }
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  return findings.map((finding) => {
    const citedFacts = [...new Set(finding.factIds)]
      .map((factId) => factById.get(factId))
      .filter((fact): fact is PlanRealityFact => fact !== undefined);
    if (citedFacts.length === 0) {
      return '';
    }
    // 인용한 사실을 모두 이어붙이면 근거 한 줄이 지적 문장보다 길어진다. 첫 근거만 보이고
    // 나머지는 건수로 접는다 — 전체 근거는 원장의 fact table evidence 에 남는다.
    const [firstFact, ...restFacts] = citedFacts;
    const summary = buildFactSummary(firstFact);
    if (restFacts.length === 0) {
      return summary;
    }
    return `${summary} (외 ${restFacts.length}건)`;
  });
};

const buildFactSummary = (fact: PlanRealityFact): string => {
  // UNPLANNED_ASSIGNED 의 detail("계획에 없는 담당 항목")은 근거가 아니라 판정이다.
  // 그 판정은 finding 이 이미 문장으로 말하므로, 근거 줄에 다시 적으면
  // "근거: (방금 한 말 다시 쓰기)" 가 된다. 다른 kind 의 detail 은 실측이라
  // (멈춘 이유·머지 여부·멘션 채널) 그대로 남긴다.
  if (fact.kind === 'UNPLANNED_ASSIGNED') {
    return fact.label;
  }
  return `${fact.label} — ${fact.detail}`;
};

interface BuildPromptInput {
  planJson: string;
  planEndedAt: string;
  planAgentRunId: number;
  citableFacts: PlanRealityFact[];
  contextFacts: PlanRealityFact[];
  extraContext: string;
  goals: ProductGoalRecord[];
}

const buildPrompt = ({
  planJson,
  planEndedAt,
  planAgentRunId,
  citableFacts,
  contextFacts,
  extraContext,
  goals,
}: BuildPromptInput): string => {
  const sections = [
    // 섹션 라벨은 우리가 만든 문구라 경계 밖에 둔다 — 안에 넣으면 이 섹션이 무엇인지조차
    // 외부 주장으로 읽힌다. 경계 안에는 남이 쓴 값만 넣는다.
    `[직전 PM plan — AgentRun #${planAgentRunId}, endedAt ${planEndedAt}]`,
    // plan 은 우리 PM 이 만든 JSON 이지만, 그 안의 태스크 제목은 GitHub·Notion 에서 온
    // 남의 문자열이다. PM 은 자기 프롬프트에서 그 제목을 경계로 감쌌는데, 원장에 저장된
    // 출력을 여기서 다시 읽으면 그 경계가 벗겨진 상태로 들어온다 — 한 바퀴 돌아온 값에
    // 경계를 다시 씌운다.
    wrapUntrustedInput(planJson),
    '[정오 사실표]',
    buildFactTable({ facts: citableFacts }),
    // 직전 회차에 이미 알린 사실. 같은 지적을 매일 되풀이하지 않도록 인용 대상에서 뺀다.
    '[이미 알린 사실 — 맥락으로만 읽는다]',
    buildFactTable({ facts: contextFacts }),
    // 사용자가 직접 적어 보낸 상황이라 경계를 씌우지 않는다. 이 워커에서 명령권자는 사용자다.
    '[추가 컨텍스트]',
    extraContext.length > 0 ? extraContext : '(없음)',
    // 목표가 없으면 섹션 자체를 싣지 않는다 — 목표를 쓰지 않는 사용자의 프롬프트는 그대로다.
    ...(goals.length > 0 ? ['[활성 제품 목표]', buildGoalSection(goals)] : []),
  ];
  return sections.join('\n\n');
};

const buildFactTable = ({ facts }: { facts: PlanRealityFact[] }): string => {
  if (facts.length === 0) {
    return '(없음)';
  }
  // label 은 GitHub·Notion 제목과 Slack 멘션 본문이라 남이 쓴 값이다. detail 은 대부분
  // 우리 고정 문구지만(WORKER_FAILED 의 예외 메시지만 예외), 줄 단위로 나눠 감싸면 표
  // 한 장에 마커가 수십 개 박힌다 — PM 의 GitHub·Slack 섹션과 같이 표 전체를 한 번 감싼다.
  //
  // id 도 경계 안에 들어가지만 인용은 그대로 된다 — 경계는 "지시로 따르지 말라" 이지
  // "읽지 말라" 가 아니다. 인용 검증은 코드가 사실표 원본과 대조하므로(po-shadow.guard.ts)
  // 모델이 경계 안의 id 를 어떻게 읽든 없는 id 는 통과하지 못한다.
  //
  // redact 는 걸지 않는다: label 은 30~40자로 잘린 스니펫이고 그대로 카드 근거 줄이 된다.
  // 짧은 라벨을 [REDACTED] 로 바꾸면 사용자가 보는 근거가 먼저 깎인다 — 주 방어는 마커다.
  const table = facts
    .map((fact) => {
      const url = fact.url ? ` | url: ${fact.url}` : '';
      return `- id: ${fact.id} | label: ${fact.label} | detail: ${fact.detail}${url}`;
    })
    .join('\n');
  return wrapUntrustedInput(table);
};

// 목표는 대표가 확인 카드로 확정한 값이라 경계를 씌우지 않는다(추가 컨텍스트와 같은 이유).
// 판정 지시를 시스템 프롬프트가 아니라 이 섹션에 두는 것도 같은 이유다 — 목표가 없는 회차의
// 시스템 프롬프트를 바꾸지 않는다.
const buildGoalSection = (goals: ProductGoalRecord[]): string => {
  const lines = goals.map((goal) => {
    const dueDate =
      goal.dueDate === null ? '없음' : goal.dueDate.toISOString().slice(0, 10);
    return `- ${goal.title} | 달성 기준: ${goal.successCriterion ?? '없음'} | 기한: ${dueDate}`;
  });
  return [
    ...lines,
    '대표가 확정한 이번 분기 판단 기준이다. 달성 기준을 충족했는지는 사실표에 없다 — 말하려면 judgments 에만 한 문장으로 쓴다(카드에 "추정" 이 붙는다). 기한이 지난 목표가 있으면 그 기준 충족 여부에 대한 판단을 judgments 에 쓴다. GOAL_UNSERVED·GOAL_DEADLINE_RISK 는 다른 사실처럼 factId 로 인용할 수 있다.',
  ].join('\n');
};

// 회수 결과를 카드가 렌더할 형태로 옮긴다. 지적이 하나도 없던 회차에는 null 이라
// 포맷터가 블록 자체를 그리지 않는다.
const toRecoverySummary = (
  recovery: FindingRecoveryResult,
): PoShadowRecoverySummary | null => {
  if (recovery.totalPriorKeys === 0) {
    return null;
  }
  return {
    merged: recovery.movementTally.merged,
    unresolved: recovery.movementTally.unresolved,
    unmovedFactCount: recovery.facts.filter(
      (fact) => fact.kind === 'FINDING_UNMOVED',
    ).length,
    abandoned: recovery.movementTally.abandoned,
    unassigned: recovery.movementTally.unassigned,
    uncomparable: recovery.uncomparableCount,
    total: recovery.totalPriorKeys,
    reasonWithdrawnKeys: recovery.reasonWithdrawnKeys,
  };
};
