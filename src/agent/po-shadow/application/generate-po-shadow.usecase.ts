import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { coerceToDailyPlan } from '../../pm/domain/prompt/previous-plan-formatter';
import {
  buildFindingRecoveryFacts,
  buildPlanRealityFacts,
  DEGRADED_PRIOR_REPORT,
  DEGRADED_UNCOMPARABLE,
  extractPriorFindingKeys,
  FindingRecoveryResult,
  hasPlanRealityMismatch,
  PlanRealityFact,
  PriorFinding,
  RecoveryLifecycle,
} from '../domain/plan-reality.diff';
import { PoShadowException } from '../domain/po-shadow.exception';
import { guardPoShadowReport } from '../domain/po-shadow.guard';
import {
  GeneratePoShadowInput,
  PoShadowContext,
  PoShadowFinding,
  PoShadowRecoverySummary,
  PoShadowReport,
} from '../domain/po-shadow.type';
import { PoShadowErrorCode } from '../domain/po-shadow-error-code.enum';
import { parsePoShadowReport } from '../domain/prompt/po-shadow.parser';
import { PO_SHADOW_OUTPUT_SCHEMA } from '../domain/prompt/po-shadow.schema';
import { collectStoredFactIds } from '../domain/prompt/po-shadow-report.coercer';
import { PO_SHADOW_SYSTEM_PROMPT } from '../domain/prompt/po-shadow-system.prompt';
import { PoShadowContextCollector } from './po-shadow-context.collector';

const STALENESS_THRESHOLD_MS = 18 * 60 * 60 * 1000;
// 회수 대상을 찾는 원장 조회 창. 실측(2026-09-10) 상 지적 키의 최장 지속이 17일이라 30일이면
// 모든 키의 firstReportedAt 을 보존한다.
const RECOVERY_LOOKBACK_DAYS = 30;
const RECOVERY_LOOKBACK_LIMIT = 40;

@Injectable()
export class GeneratePoShadowUsecase {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly contextCollector: PoShadowContextCollector,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
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
    const recovery = await this.recoverPriorFindings({
      slackUserId,
      context,
      now,
    });
    const facts = [...planFacts, ...recovery.facts];
    const recoverySummary = toRecoverySummary(recovery);
    // 사용자가 "릴리즈 오늘로 변경" 같은 상황을 직접 적어 보냈다면 사실표가 조용해도 검토한다.
    // 어긋남만으로 갈림길을 정하면 사용자가 친 말이 evidence 에만 저장되고 답은
    // "계획대로 진행 중" 으로 나간다.
    const needsReview =
      hasPlanRealityMismatch(facts) || trimmedExtra.length > 0;

    return this.agentRunService.execute({
      agentType: AgentType.PO_SHADOW,
      triggerType: triggerType ?? TriggerType.SLACK_COMMAND_PO_SHADOW,
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
        if (!needsReview) {
          const report = buildQuietReport({
            facts,
            degradedSources: recovery.degradedSources,
            recoverySummary,
          });
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
          facts,
          extraContext: trimmedExtra,
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
        const report = buildGuardedReport({
          report: parsedReport,
          facts,
          degradedSources: recovery.degradedSources,
          recoverySummary,
        });
        return {
          result: report,
          modelUsed: completion.modelUsed,
          output: report,
        };
      },
    });
  }

  // 직전 회차들이 지적한 키가 어떻게 끝났는지 회수한다. 원장 조회 1회 + 담당 목록에 없는 키에
  // 대해서만 GitHub 단건 조회(실측상 하루 한 자릿수)를 돈다.
  private async recoverPriorFindings({
    slackUserId,
    context,
    now,
  }: {
    slackUserId: string;
    context: PoShadowContext;
    now: Date;
  }): Promise<FindingRecoveryResult & { degradedSources: string[] }> {
    const degradedSources = [...context.degradedSources];
    const empty: FindingRecoveryResult = {
      facts: [],
      movementTally: { merged: 0, unresolved: 0, abandoned: 0, unassigned: 0 },
      uncomparableCount: 0,
      totalPriorKeys: 0,
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
      priorFindings = extractPriorFindingKeys(
        parsedRuns.map((run) => ({
          factIds: run.factIds ?? [],
          endedAt: run.endedAt,
        })),
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
  facts: PlanRealityFact[];
  extraContext: string;
}

const buildPrompt = ({
  planJson,
  planEndedAt,
  planAgentRunId,
  facts,
  extraContext,
}: BuildPromptInput): string => {
  const sections = [
    `[직전 PM plan — AgentRun #${planAgentRunId}, endedAt ${planEndedAt}]`,
    planJson,
    '[정오 사실표]',
    buildFactTable({ facts }),
    '[추가 컨텍스트]',
    extraContext.length > 0 ? extraContext : '(없음)',
  ];
  return sections.join('\n\n');
};

const buildFactTable = ({ facts }: { facts: PlanRealityFact[] }): string => {
  if (facts.length === 0) {
    return '(없음)';
  }
  return facts
    .map((fact) => {
      const url = fact.url ? ` | url: ${fact.url}` : '';
      return `- id: ${fact.id} | label: ${fact.label} | detail: ${fact.detail}${url}`;
    })
    .join('\n');
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
  };
};
