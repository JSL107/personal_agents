import { Injectable } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { coerceToDailyPlan } from '../../pm/domain/prompt/previous-plan-formatter';
import {
  buildPlanRealityFacts,
  hasPlanRealityMismatch,
  PlanRealityFact,
} from '../domain/plan-reality.diff';
import { PoShadowException } from '../domain/po-shadow.exception';
import { guardPoShadowReport } from '../domain/po-shadow.guard';
import {
  GeneratePoShadowInput,
  PoShadowFinding,
  PoShadowReport,
} from '../domain/po-shadow.type';
import { PoShadowErrorCode } from '../domain/po-shadow-error-code.enum';
import { parsePoShadowReport } from '../domain/prompt/po-shadow.parser';
import { PO_SHADOW_OUTPUT_SCHEMA } from '../domain/prompt/po-shadow.schema';
import { PO_SHADOW_SYSTEM_PROMPT } from '../domain/prompt/po-shadow-system.prompt';
import { PoShadowContextCollector } from './po-shadow-context.collector';

const STALENESS_THRESHOLD_MS = 18 * 60 * 60 * 1000;

@Injectable()
export class GeneratePoShadowUsecase {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly contextCollector: PoShadowContextCollector,
  ) {}

  async execute({
    extraContext,
    slackUserId,
    triggerType,
    enforcePlanFreshness,
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
    const planAgeMilliseconds = Date.now() - snapshot.endedAt.getTime();
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
    const facts = buildPlanRealityFacts(plan, context);
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
            degradedSources: context.degradedSources,
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
          degradedSources: context.degradedSources,
        });
        return {
          result: report,
          modelUsed: completion.modelUsed,
          output: report,
        };
      },
    });
  }
}

interface BuildQuietReportInput {
  facts: PlanRealityFact[];
  degradedSources: string[];
}

const buildQuietReport = ({
  facts,
  degradedSources,
}: BuildQuietReportInput): PoShadowReport => ({
  schemaVersion: 2,
  quiet: true,
  headline: '계획대로 진행 중',
  findings: [],
  purposeConflict: null,
  factSummary: facts.map(buildFactSummary),
  droppedFindingCount: 0,
  degradedSources,
});

interface BuildGuardedReportInput {
  report: PoShadowReport;
  facts: PlanRealityFact[];
  degradedSources: string[];
}

const buildGuardedReport = ({
  report,
  facts,
  degradedSources,
}: BuildGuardedReportInput): PoShadowReport => {
  const guardedReport = guardPoShadowReport(
    {
      ...report,
      schemaVersion: 2,
      quiet: false,
      factSummary: [],
      droppedFindingCount: 0,
      degradedSources,
    },
    facts,
  );
  const factSummary = buildFindingFactSummaries({
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
