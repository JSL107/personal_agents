import { Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { DailyPlanService } from '../../../daily-plan/application/daily-plan.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { AppendDailyPlanUsecase } from '../../../notion/application/append-daily-plan.usecase';
import { PmAgentException } from '../domain/pm-agent.exception';
import {
  DailyPlan,
  DailyPlanInputSnapshot,
  DailyPlanResult,
  DailyPlanSource,
  GenerateDailyPlanInput,
} from '../domain/pm-agent.type';
import { PmAgentErrorCode } from '../domain/pm-agent-error-code.enum';
import { parseDailyPlan } from '../domain/prompt/daily-plan.parser';
import { PM_SYSTEM_PROMPT } from '../domain/prompt/pm-system.prompt';
import {
  DailyPlanContext,
  DailyPlanContextCollector,
  RECENT_PLAN_LOOKBACK_DAYS,
  SLACK_MENTION_SINCE_HOURS,
} from './daily-plan-context.collector';
import { DailyPlanEvidenceBuilder } from './daily-plan-evidence.builder';
import {
  DailyPlanPromptBuilder,
  TruncationMeta,
} from './daily-plan-prompt.builder';

const KST_OFFSET_HOURS = 9;

// KST (UTC+9) 기준 "오늘 날짜" 를 UTC 00:00:00 Date 로 반환.
// @db.Date 컬럼은 날짜만 저장하므로 시간 정보 제거. 한국 사용자 하루 경계 (00:00 KST) 에 맞춤.
const getKstTodayAsUtcDate = (): Date => {
  const nowMs = Date.now();
  const kstMs = nowMs + KST_OFFSET_HOURS * 60 * 60 * 1000;
  const kstDate = new Date(kstMs);
  return new Date(
    Date.UTC(
      kstDate.getUTCFullYear(),
      kstDate.getUTCMonth(),
      kstDate.getUTCDate(),
    ),
  );
};

// PM Agent `/today` 유스케이스 — orchestration only.
// 실제 책임 분리:
//  - 외부 context 6종 수집: DailyPlanContextCollector
//  - prompt 조립 + byte cap: DailyPlanPromptBuilder
//  - evidence 조립: DailyPlanEvidenceBuilder
//  - plan 저장 (DB + Notion): DailyPlanService + AppendDailyPlanUsecase
@Injectable()
export class GenerateDailyPlanUsecase {
  private readonly logger = new Logger(GenerateDailyPlanUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly dailyPlanService: DailyPlanService,
    private readonly appendDailyPlanUsecase: AppendDailyPlanUsecase,
    private readonly contextCollector: DailyPlanContextCollector,
    private readonly promptBuilder: DailyPlanPromptBuilder,
    private readonly evidenceBuilder: DailyPlanEvidenceBuilder,
  ) {}

  async execute({
    tasksText,
    slackUserId,
    triggerType,
  }: GenerateDailyPlanInput): Promise<AgentRunOutcome<DailyPlanResult>> {
    const userText = tasksText.trim();
    // OPS-8: 호출자가 명시한 triggerType 사용 (Morning Briefing CRON 등). 미지정시 수동 /today.
    const effectiveTriggerType = triggerType ?? TriggerType.SLACK_COMMAND_TODAY;

    // planDate 는 request 진입 "첫 await 이전" 시점에 고정한다.
    // context collect 과 model completion 합쳐 10~40s 걸리므로 그 사이 midnight 를 넘기면
    // next-day row / Notion page 로 저장되는 regression 방지
    // (codex review b1309omm0 P1 → bi531458d P1 재지적).
    const planDate = getKstTodayAsUtcDate();

    const context = await this.contextCollector.collect({
      userText,
      slackUserId,
    });

    this.assertNonEmptyInput(context);

    const { prompt, truncated } = this.promptBuilder.build(context);
    const evidence = this.evidenceBuilder.build(context);
    const inputSnapshot = this.buildInputSnapshot({
      context,
      combinedPrompt: prompt,
      truncated,
    });

    const outcome = await this.agentRunService.execute<DailyPlan>({
      agentType: AgentType.PM,
      triggerType: effectiveTriggerType,
      inputSnapshot,
      evidence,
      run: async ({ agentRunId }) => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.PM,
          request: { prompt, systemPrompt: PM_SYSTEM_PROMPT },
        });
        const innerPlan = parseDailyPlan(completion.text);
        const innerSources = extractSources(context);

        await this.persistPlanGracefully({
          plan: innerPlan,
          sources: innerSources,
          agentRunId,
          planDate,
        });

        return {
          result: innerPlan,
          modelUsed: completion.modelUsed,
          output: innerPlan,
        };
      },
    });

    return {
      result: { plan: outcome.result, sources: extractSources(context) },
      modelUsed: outcome.modelUsed,
      agentRunId: outcome.agentRunId,
    };
  }

  private assertNonEmptyInput(context: DailyPlanContext): void {
    const githubItemCount = context.githubTasks
      ? context.githubTasks.issues.length +
        context.githubTasks.pullRequests.length
      : 0;
    if (
      context.userText.length === 0 &&
      githubItemCount === 0 &&
      context.notionTasks.length === 0
    ) {
      throw new PmAgentException({
        code: PmAgentErrorCode.EMPTY_TASKS_INPUT,
        message:
          '오늘 할 일이 비어있고 GitHub / Notion 자동 수집도 비어있습니다. `/today <할 일>` 형식으로 입력하거나 GITHUB_TOKEN / NOTION_TOKEN 을 설정해주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }
  }

  // daily_plan 테이블 upsert + Notion Daily Plan 페이지 append.
  // 둘 다 graceful — 어느 하나 실패해도 plan 결과는 사용자에게 정상 반환.
  private async persistPlanGracefully({
    plan,
    sources,
    agentRunId,
    planDate,
  }: {
    plan: DailyPlan;
    sources: DailyPlanSource[];
    agentRunId: number;
    planDate: Date;
  }): Promise<void> {
    try {
      await this.dailyPlanService.recordDailyPlan({
        planDate,
        plan,
        agentRunId,
        evidenceIds: [],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `daily_plan 기록 실패 (plan 응답은 정상 반환): ${message}`,
      );
    }

    try {
      await this.appendDailyPlanUsecase.execute({ plan, planDate, sources });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Notion Daily Plan 기록 실패 (plan 응답은 정상 반환): ${message}`,
      );
    }
  }

  private buildInputSnapshot({
    context,
    combinedPrompt,
    truncated,
  }: {
    context: DailyPlanContext;
    combinedPrompt: string;
    truncated: TruncationMeta;
  }): DailyPlanInputSnapshot {
    const {
      userText,
      slackUserId,
      githubTasks,
      previousPlan,
      previousWorklog,
      slackMentions,
      notionTasks,
      recentPlanSummaries,
    } = context;
    const githubItemCount = githubTasks
      ? githubTasks.issues.length + githubTasks.pullRequests.length
      : 0;
    return {
      tasksText: userText,
      slackUserId,
      githubItemCount,
      githubFetchAttempted: true,
      githubFetchSucceeded: githubTasks !== null,
      previousPlanReferenced: previousPlan !== null,
      previousPlanAgentRunId: previousPlan ? previousPlan.agentRunId : null,
      previousWorklogReferenced: previousWorklog !== null,
      previousWorklogAgentRunId: previousWorklog
        ? previousWorklog.agentRunId
        : null,
      slackMentionCount: slackMentions.length,
      slackMentionSinceHours: SLACK_MENTION_SINCE_HOURS,
      notionTaskCount: notionTasks.length,
      recentPlanLookbackDays: RECENT_PLAN_LOOKBACK_DAYS,
      recentPlanSampleCount: recentPlanSummaries.length,
      promptByteLength: Buffer.byteLength(combinedPrompt, 'utf8'),
      truncated: {
        github: truncated.github,
        notion: truncated.notion,
        slackMentions: truncated.slackMentions,
        droppedSections: truncated.droppedSections,
      },
    };
  }
}

// DailyPlanContext 에서 Slack 응답에 노출할 "참조 소스" 엔트리 추출.
// 사용자가 plan 이 어떤 데이터에 근거해 만들어졌는지 즉시 확인할 수 있도록 제목 + URL 을 제공.
// PM-4: notion 모듈의 `let 제거 + 선언적 변환` 컨벤션과 일관 — push 대신 source 별 배열 spread.
const extractSources = (context: DailyPlanContext): DailyPlanSource[] => {
  const githubSources: DailyPlanSource[] = context.githubTasks
    ? [
        ...context.githubTasks.issues.map(
          (issue): DailyPlanSource => ({
            type: 'github_issue',
            label: `${issue.repo}#${issue.number} — ${issue.title}`,
            url: issue.url,
          }),
        ),
        ...context.githubTasks.pullRequests.map(
          (pr): DailyPlanSource => ({
            type: 'github_pull_request',
            label: `${pr.repo}#${pr.number} — ${pr.title}${pr.draft ? ' [draft]' : ''}`,
            url: pr.url,
          }),
        ),
      ]
    : [];

  const notionSources: DailyPlanSource[] = context.notionTasks.map(
    (task): DailyPlanSource => ({
      type: 'notion_task',
      label: task.title,
      url: task.url,
    }),
  );

  const slackSources: DailyPlanSource[] =
    context.slackMentions.length > 0
      ? [
          {
            type: 'slack_mention',
            label: `최근 ${SLACK_MENTION_SINCE_HOURS}h 본인 멘션 ${context.slackMentions.length}건`,
          },
        ]
      : [];

  const previousPlanSources: DailyPlanSource[] = context.previousPlan
    ? [
        {
          type: 'previous_plan',
          label: `직전 PM 실행 #${context.previousPlan.agentRunId} (${context.previousPlan.endedAt.toISOString().slice(0, 10)})`,
        },
      ]
    : [];

  const previousWorklogSources: DailyPlanSource[] = context.previousWorklog
    ? [
        {
          type: 'previous_worklog',
          label: `직전 Work Reviewer 실행 #${context.previousWorklog.agentRunId} (${context.previousWorklog.endedAt.toISOString().slice(0, 10)})`,
        },
      ]
    : [];

  return [
    ...githubSources,
    ...notionSources,
    ...slackSources,
    ...previousPlanSources,
    ...previousWorklogSources,
  ];
};
