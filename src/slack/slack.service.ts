import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, LogLevel } from '@slack/bolt';

import { GenerateBackendPlanUsecase } from '../agent/be/application/generate-backend-plan.usecase';
import { BackendPlan } from '../agent/be/domain/be-agent.type';
import { ReviewPullRequestUsecase } from '../agent/code-reviewer/application/review-pull-request.usecase';
import { PullRequestReview } from '../agent/code-reviewer/domain/code-reviewer.type';
import { GenerateImpactReportUsecase } from '../agent/impact-reporter/application/generate-impact-report.usecase';
import { ImpactReport } from '../agent/impact-reporter/domain/impact-reporter.type';
import { GenerateDailyPlanUsecase } from '../agent/pm/application/generate-daily-plan.usecase';
import {
  ContextSummary,
  SyncContextUsecase,
} from '../agent/pm/application/sync-context.usecase';
import { DailyPlan, TaskItem } from '../agent/pm/domain/pm-agent.type';
import { GeneratePoShadowUsecase } from '../agent/po-shadow/application/generate-po-shadow.usecase';
import { PoShadowReport } from '../agent/po-shadow/domain/po-shadow.type';
import { GenerateWorklogUsecase } from '../agent/work-reviewer/application/generate-worklog.usecase';
import { DailyReview } from '../agent/work-reviewer/domain/work-reviewer.type';
import { DomainException } from '../common/exception/domain.exception';

// 이대리 Slack 어댑터.
// SLACK_BOT_TOKEN / SLACK_APP_TOKEN / SLACK_SIGNING_SECRET 가 모두 설정된 경우에만 Socket Mode 로 기동한다.
// 토큰이 없는 로컬/CI 환경에서는 경고 로그만 남기고 부팅을 계속한다 (멀티 도메인 환경에서 Slack 이 부팅 블로커가 되지 않도록).
@Injectable()
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private app?: App;

  constructor(
    private readonly configService: ConfigService,
    private readonly generateDailyPlanUsecase: GenerateDailyPlanUsecase,
    private readonly generateWorklogUsecase: GenerateWorklogUsecase,
    private readonly reviewPullRequestUsecase: ReviewPullRequestUsecase,
    private readonly syncContextUsecase: SyncContextUsecase,
    private readonly generateImpactReportUsecase: GenerateImpactReportUsecase,
    private readonly generatePoShadowUsecase: GeneratePoShadowUsecase,
    private readonly generateBackendPlanUsecase: GenerateBackendPlanUsecase,
  ) {}

  async onModuleInit(): Promise<void> {
    const botToken = this.configService.get<string>('SLACK_BOT_TOKEN');
    const appToken = this.configService.get<string>('SLACK_APP_TOKEN');
    const signingSecret = this.configService.get<string>(
      'SLACK_SIGNING_SECRET',
    );

    const missingKeys = [
      ['SLACK_BOT_TOKEN', botToken],
      ['SLACK_APP_TOKEN', appToken],
      ['SLACK_SIGNING_SECRET', signingSecret],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missingKeys.length > 0) {
      this.logger.warn(
        `Slack 토큰 누락: ${missingKeys.join(', ')} — 이대리 Slack 봇을 초기화하지 않습니다.`,
      );
      return;
    }

    const app = new App({
      token: botToken,
      appToken,
      signingSecret,
      socketMode: true,
      logLevel: LogLevel.INFO,
    });

    this.registerCommands(app);

    // Slack 기동 실패(유효하지 않은 토큰, Slack 일시적 장애 등)가 전체 NestJS 앱 부팅을 막지 않도록 격리한다.
    // 앱은 계속 떠 있고 Slack 기능만 비활성화된 상태로 남는다.
    try {
      await app.start();
      this.app = app;
      this.logger.log('이대리 Slack 봇이 Socket Mode 로 기동되었습니다.');
    } catch (error: unknown) {
      this.logger.error(
        '이대리 Slack 봇 기동 실패 — 앱은 계속 부팅되며 Slack 기능만 비활성화됩니다.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.app) {
      return;
    }

    await this.app.stop();
    this.logger.log('이대리 Slack 봇이 정상 종료되었습니다.');
  }

  private registerCommands(app: App): void {
    app.command('/ping', async ({ ack, respond }) => {
      await ack();
      await respond(`이대리 pong — ${new Date().toISOString()}`);
    });

    app.command('/today', async ({ ack, command, respond }) => {
      const tasksText = command.text?.trim() ?? '';
      if (tasksText.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/today <오늘 할 일을 자유롭게 적어주세요>`',
        });
        return;
      }

      // ack body 로 즉시 "작성 중" 메시지를 보낸다 (Slack Bolt slow-command 공식 패턴).
      // 이후 respond(replace_original: true) 가 성공하면 최종 결과로 교체되고, 실패해도 메시지가 누적될 뿐 UX 퇴보는 없다.
      await ack({
        response_type: 'ephemeral',
        text: '이대리가 오늘의 계획을 작성 중입니다 (10~20초 소요)...',
      });

      try {
        const plan = await this.generateDailyPlanUsecase.execute({
          tasksText,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatDailyPlan(plan),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `GenerateDailyPlanUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        // 도메인 예외(PmAgentException 등) 의 message 는 사용자 안내용으로 설계돼 있어 그대로 노출 가능.
        // 그 외(Prisma/네트워크/라이브러리 내부 에러 등) 는 DB URL / stack / 내부 경로가 섞일 수 있어 generic 메시지로 가린다.
        const userFacingMessage =
          error instanceof DomainException
            ? rawMessage
            : '내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /today 실패: ${userFacingMessage}`,
        });
      }
    });

    app.command('/worklog', async ({ ack, command, respond }) => {
      const workText = command.text?.trim() ?? '';
      if (workText.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/worklog <오늘 한 일을 자유롭게 적어주세요>`',
        });
        return;
      }

      await ack({
        response_type: 'ephemeral',
        text: '이대리가 오늘의 회고를 작성 중입니다 (10~20초 소요)...',
      });

      try {
        const review = await this.generateWorklogUsecase.execute({
          workText,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatDailyReview(review),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `GenerateWorklogUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        const userFacingMessage =
          error instanceof DomainException
            ? rawMessage
            : '내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /worklog 실패: ${userFacingMessage}`,
        });
      }
    });

    app.command('/plan-task', async ({ ack, command, respond }) => {
      const subject = command.text?.trim() ?? '';
      if (subject.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/plan-task <PR URL / 작업 설명>` (예: `/plan-task 결제 검증 API 추가` 또는 `/plan-task foo/bar#34`)',
        });
        return;
      }

      await ack({
        response_type: 'ephemeral',
        text: `이대리(BE 모드) 가 구현 계획을 세우는 중입니다 (15~40초 소요)...`,
      });

      try {
        const plan = await this.generateBackendPlanUsecase.execute({
          subject,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatBackendPlan(plan),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `GenerateBackendPlanUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        const userFacingMessage =
          error instanceof DomainException
            ? rawMessage
            : '내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /plan-task 실패: ${userFacingMessage}`,
        });
      }
    });

    app.command('/po-shadow', async ({ ack, command, respond }) => {
      // /po-shadow 는 직전 PM plan 을 PO 시각으로 재검토 — 인자 없이도 OK (extra context optional).
      const extraContext = command.text?.trim() ?? '';
      await ack({
        response_type: 'ephemeral',
        text: '이대리(PO 모드) 가 직전 plan 을 재검토 중입니다 (10~30초 소요)...',
      });

      try {
        const report = await this.generatePoShadowUsecase.execute({
          extraContext,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatPoShadowReport(report),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `GeneratePoShadowUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        const userFacingMessage =
          error instanceof DomainException
            ? rawMessage
            : '내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /po-shadow 실패: ${userFacingMessage}`,
        });
      }
    });

    app.command('/impact-report', async ({ ack, command, respond }) => {
      const subject = command.text?.trim() ?? '';
      if (subject.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/impact-report <PR 링크 또는 task 설명>` (예: `/impact-report PR #34 — GitHub 커넥터 추가`)',
        });
        return;
      }

      await ack({
        response_type: 'ephemeral',
        text: `이대리가 임팩트 보고서를 작성 중입니다 (10~30초 소요)...`,
      });

      try {
        const report = await this.generateImpactReportUsecase.execute({
          subject,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatImpactReport(report),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `GenerateImpactReportUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        const userFacingMessage =
          error instanceof DomainException
            ? rawMessage
            : '내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /impact-report 실패: ${userFacingMessage}`,
        });
      }
    });

    app.command('/sync-context', async ({ ack, command, respond }) => {
      // 모델 호출 없는 가벼운 상태 점검 — 즉시 ack 후 실제 결과로 교체.
      await ack({
        response_type: 'ephemeral',
        text: '이대리가 컨텍스트(GitHub/Notion/Slack/직전 실행)를 재수집 중입니다 (수 초 소요)...',
      });

      try {
        const summary = await this.syncContextUsecase.execute({
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatContextSummary(summary),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `SyncContextUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        const userFacingMessage =
          error instanceof DomainException
            ? rawMessage
            : '내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /sync-context 실패: ${userFacingMessage}`,
        });
      }
    });

    app.command('/review-pr', async ({ ack, command, respond }) => {
      const prRef = command.text?.trim() ?? '';
      if (prRef.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/review-pr <PR URL 또는 owner/repo#번호>` (예: `/review-pr https://github.com/foo/bar/pull/34`)',
        });
        return;
      }

      await ack({
        response_type: 'ephemeral',
        text: `이대리가 PR ${prRef} 를 리뷰하는 중입니다 (15~40초 소요)...`,
      });

      try {
        const review = await this.reviewPullRequestUsecase.execute({
          prRef,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatPullRequestReview({ prRef, review }),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `ReviewPullRequestUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        const userFacingMessage =
          error instanceof DomainException
            ? rawMessage
            : '내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /review-pr 실패: ${userFacingMessage}`,
        });
      }
    });
  }
}

// /plan-task 결과 — BackendPlan 을 한국어 Slack 마크다운으로 렌더.
export const formatBackendPlan = (plan: BackendPlan): string => {
  const lines: string[] = [
    `*백엔드 구현 계획* — ${plan.subject}`,
    '',
    `📌 *컨텍스트*: ${plan.context}`,
    '',
    '*구현 체크리스트*',
    ...plan.implementationChecklist.flatMap((item) => {
      const dep =
        item.dependsOn.length > 0
          ? ` _(선행: ${item.dependsOn.join(', ')})_`
          : '';
      return [`• *${item.title}*${dep}`, `   ↳ ${item.description}`];
    }),
    '',
  ];

  if (plan.apiDesign && plan.apiDesign.length > 0) {
    lines.push('*API 설계*');
    for (const api of plan.apiDesign) {
      lines.push(`• \`${api.method} ${api.path}\``);
      lines.push(`   req: ${api.request}`);
      lines.push(`   res: ${api.response}`);
      if (api.notes.length > 0) {
        lines.push(`   📝 ${api.notes}`);
      }
    }
    lines.push('');
  }

  if (plan.risks.length > 0) {
    lines.push('*리스크*', ...plan.risks.map((r) => `• ${r}`), '');
  }

  if (plan.testPoints.length > 0) {
    lines.push('*테스트 포인트*', ...plan.testPoints.map((t) => `• ${t}`), '');
  }

  lines.push(
    `*예상 소요*: ${plan.estimatedHours}시간`,
    '',
    `*판단 근거*: ${plan.reasoning}`,
  );

  return lines.join('\n');
};

// /po-shadow 결과 — PO 시각의 검토를 한국어 Slack 마크다운으로 렌더.
export const formatPoShadowReport = (report: PoShadowReport): string => {
  const lines: string[] = [
    '*PO Shadow 검토*',
    '',
    `🎯 *우선순위 재점검*: ${report.priorityRecheck}`,
    '',
    `❓ *진짜 목적 재질문*: ${report.realPurposeQuestion}`,
    '',
  ];

  if (report.missingRequirements.length > 0) {
    lines.push(
      '*누락 가능 요구사항*',
      ...report.missingRequirements.map((r) => `• ${r}`),
      '',
    );
  }

  if (report.releaseRisks.length > 0) {
    lines.push(
      '*release 리스크*',
      ...report.releaseRisks.map((r) => `• ${r}`),
      '',
    );
  }

  lines.push('*권고*', report.recommendation);
  return lines.join('\n');
};

// /impact-report 결과 — 임팩트 보고서를 한국어 Slack 마크다운으로 렌더.
export const formatImpactReport = (report: ImpactReport): string => {
  const lines: string[] = [
    `*임팩트 보고서* — ${report.subject}`,
    '',
    `📌 *Headline*: ${report.headline}`,
    '',
  ];

  if (report.quantitative.length > 0) {
    lines.push(
      '*정량 근거*',
      ...report.quantitative.map((item) => `• ${item}`),
      '',
    );
  }

  lines.push('*질적 영향*', report.qualitative, '');

  const renderArea = (label: string, items: string[]): void => {
    if (items.length === 0) {
      return;
    }
    lines.push(`*${label}*`, ...items.map((i) => `• ${i}`), '');
  };
  renderArea('사용자 영향', report.affectedAreas.users);
  renderArea('팀/협업 영향', report.affectedAreas.team);
  renderArea('서비스/시스템 영향', report.affectedAreas.service);

  if (report.beforeAfter) {
    lines.push(
      '*개선 전/후*',
      `• 개선 전: ${report.beforeAfter.before}`,
      `• 개선 후: ${report.beforeAfter.after}`,
      '',
    );
  }

  if (report.risks.length > 0) {
    lines.push('*리스크*', ...report.risks.map((r) => `• ${r}`), '');
  }

  lines.push('*판단 근거*', report.reasoning);

  return lines.join('\n');
};

// /sync-context 결과를 사용자에게 보여줄 한국어 요약 — 5종 source 의 현재 상태 + 직전 실행 메타.
export const formatContextSummary = (summary: ContextSummary): string => {
  const githubLine = summary.github.fetchSucceeded
    ? `• GitHub assigned: issue ${summary.github.issueCount}건 / PR ${summary.github.pullRequestCount}건`
    : '• GitHub assigned: 수집 실패 (GITHUB_TOKEN 미설정 또는 권한 문제)';
  const notionLine = `• Notion task DB: ${summary.notion.taskCount}건`;
  const slackLine = `• Slack 멘션 (${summary.slack.sinceHours}h): ${summary.slack.mentionCount}건`;
  const previousPlanLine = summary.previousPlan
    ? `• 직전 PM 실행 #${summary.previousPlan.agentRunId} (${summary.previousPlan.endedAt})`
    : '• 직전 PM 실행: 없음';
  const previousWorklogLine = summary.previousWorklog
    ? `• 직전 Work Reviewer 실행 #${summary.previousWorklog.agentRunId} (${summary.previousWorklog.endedAt})`
    : '• 직전 Work Reviewer 실행: 없음';

  return [
    '*컨텍스트 재수집 완료* — 다음 `/today` 호출 시 동일한 데이터를 모델에게 전달합니다.',
    '',
    githubLine,
    notionLine,
    slackLine,
    '',
    previousPlanLine,
    previousWorklogLine,
  ].join('\n');
};

const renderTaskLine = (task: TaskItem): string => {
  const critical = task.isCriticalPath ? '⚠ ' : '';
  const wbs =
    task.subtasks.length > 0
      ? `\n${task.subtasks
          .map((s) => `   ↳ ${s.title} (${s.estimatedMinutes}m)`)
          .join('\n')}`
      : '';
  return `• ${critical}${task.title}${wbs}`;
};

export const formatDailyPlan = (plan: DailyPlan): string => {
  const lines: string[] = [
    '*오늘의 최우선 과제*',
    renderTaskLine(plan.topPriority),
    '',
    '*오전*',
    ...plan.morning.map(renderTaskLine),
    '',
    '*오후*',
    ...plan.afternoon.map(renderTaskLine),
  ];

  if (plan.blocker) {
    lines.push('', `*Blocker*: ${plan.blocker}`);
  }

  // 이월 항목이 없어도 analysisReasoning 이 있으면 "왜 drop 했는지" 설명을 노출 —
  // Rollover 자율권 (Eisenhower 매트릭스) 판단 근거가 사용자에게 보여야 함 (codex review bi531458d P3).
  const { rolledOverTasks, analysisReasoning } = plan.varianceAnalysis;
  if (rolledOverTasks.length > 0 || analysisReasoning.length > 0) {
    lines.push('', '*어제 이월*');
    if (rolledOverTasks.length > 0) {
      lines.push(...rolledOverTasks.map((t) => `• ${t}`));
    }
    if (analysisReasoning.length > 0) {
      lines.push(`_이월 근거_: ${analysisReasoning}`);
    }
  }

  lines.push(
    '',
    `*예상 소요*: ${plan.estimatedHours}시간`,
    '',
    `*판단 근거*: ${plan.reasoning}`,
  );

  return lines.join('\n');
};

export const formatDailyReview = (review: DailyReview): string => {
  const lines: string[] = ['*오늘 한 일*', review.summary, ''];

  if (review.impact.quantitative.length > 0) {
    lines.push(
      '*정량 근거*',
      ...review.impact.quantitative.map((item) => `• ${item}`),
      '',
    );
  }

  lines.push('*질적 영향*', review.impact.qualitative, '');

  if (review.improvementBeforeAfter) {
    lines.push(
      '*개선 전/후*',
      `• Before: ${review.improvementBeforeAfter.before}`,
      `• After: ${review.improvementBeforeAfter.after}`,
      '',
    );
  }

  if (review.nextActions.length > 0) {
    lines.push(
      '*다음 액션*',
      ...review.nextActions.map((action) => `• ${action}`),
      '',
    );
  }

  lines.push(`*한 줄 성과*: ${review.oneLineAchievement}`);

  return lines.join('\n');
};

const RISK_LEVEL_LABEL: Record<PullRequestReview['riskLevel'], string> = {
  low: '🟢 LOW',
  medium: '🟡 MEDIUM',
  high: '🔴 HIGH',
};

const APPROVAL_LABEL: Record<
  PullRequestReview['approvalRecommendation'],
  string
> = {
  approve: '✅ Approve',
  request_changes: '✋ Request changes',
  comment: '💬 Comment',
};

export const formatPullRequestReview = ({
  prRef,
  review,
}: {
  prRef: string;
  review: PullRequestReview;
}): string => {
  const lines: string[] = [
    `*PR 리뷰 — ${prRef}*`,
    `위험도: ${RISK_LEVEL_LABEL[review.riskLevel]} · 권고: ${APPROVAL_LABEL[review.approvalRecommendation]}`,
    '',
    '*요약*',
    review.summary,
  ];

  if (review.mustFix.length > 0) {
    lines.push('', '*Must-Fix*', ...review.mustFix.map((item) => `• ${item}`));
  }

  if (review.niceToHave.length > 0) {
    lines.push(
      '',
      '*Nice-to-have*',
      ...review.niceToHave.map((item) => `• ${item}`),
    );
  }

  if (review.missingTests.length > 0) {
    lines.push(
      '',
      '*누락 테스트*',
      ...review.missingTests.map((item) => `• ${item}`),
    );
  }

  if (review.reviewCommentDrafts.length > 0) {
    lines.push('', '*리뷰 코멘트 초안*');
    for (const draft of review.reviewCommentDrafts) {
      const location =
        draft.file && draft.line
          ? `\`${draft.file}:${draft.line}\` `
          : draft.file
            ? `\`${draft.file}\` `
            : '';
      lines.push(`• ${location}${draft.body}`);
    }
  }

  return lines.join('\n');
};
