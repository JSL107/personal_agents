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
import {
  DailyPlan,
  DailyPlanSource,
  TaskItem,
} from '../agent/pm/domain/pm-agent.type';
import { GeneratePoShadowUsecase } from '../agent/po-shadow/application/generate-po-shadow.usecase';
import { PoShadowReport } from '../agent/po-shadow/domain/po-shadow.type';
import { GenerateWorklogUsecase } from '../agent/work-reviewer/application/generate-worklog.usecase';
import { DailyReview } from '../agent/work-reviewer/domain/work-reviewer.type';
import { AgentRunOutcome } from '../agent-run/application/agent-run.service';
import {
  GetQuotaStatsUsecase,
  QuotaStatsResult,
} from '../agent-run/application/get-quota-stats.usecase';
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
    private readonly generateImpactReportUsecase: GenerateImpactReportUsecase,
    private readonly generatePoShadowUsecase: GeneratePoShadowUsecase,
    private readonly generateBackendPlanUsecase: GenerateBackendPlanUsecase,
    private readonly syncContextUsecase: SyncContextUsecase,
    private readonly getQuotaStatsUsecase: GetQuotaStatsUsecase,
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

  // PRO-1: Slack 봇이 사용자 DM(`U...`) 또는 채널(`C.../G...`) 로 메시지를 발송한다.
  // chat.postMessage 의 `channel` 파라미터는 user/channel/group ID 셋 다 받는다.
  // private 채널이면 봇이 invite 돼 있어야 함 (외부 운영 책임).
  // 봇이 비활성(env 누락) 상태면 graceful — 호출자에게 명확한 예외로 끊는다.
  async postMessage({
    target,
    text,
  }: {
    target: string;
    text: string;
  }): Promise<void> {
    if (!this.app) {
      throw new Error(
        'Slack 봇이 비활성 상태입니다 (SLACK_BOT_TOKEN/APP_TOKEN/SIGNING_SECRET 누락).',
      );
    }
    await this.app.client.chat.postMessage({ channel: target, text });
  }

  private registerCommands(app: App): void {
    app.command('/today', async ({ ack, command, respond }) => {
      // 자유 텍스트는 옵션. 빈 입력이면 GitHub assigned / Notion task / Slack 멘션 / 직전 PM·Work Reviewer
      // 자동 수집만으로 plan 생성 (사용자 발견 — 적을 일이 없을 때 굳이 텍스트 강제할 이유 없음).
      // 자동 컨텍스트도 모두 비어있으면 GenerateDailyPlanUsecase 가 EMPTY_TASKS_INPUT 으로 끊고 안내한다.
      const tasksText = command.text?.trim() ?? '';
      const ackMessage =
        tasksText.length === 0
          ? '이대리가 자동 수집한 컨텍스트(GitHub/Notion/Slack/어제 plan)로 오늘의 계획을 작성 중입니다 (10~20초 소요)...'
          : '이대리가 오늘의 계획을 작성 중입니다 (10~20초 소요)...';

      // ack body 로 즉시 "작성 중" 메시지를 보낸다 (Slack Bolt slow-command 공식 패턴).
      // 이후 respond(replace_original: true) 가 성공하면 최종 결과로 교체되고, 실패해도 메시지가 누적될 뿐 UX 퇴보는 없다.
      await ack({
        response_type: 'ephemeral',
        text: ackMessage,
      });

      try {
        const outcome = await this.generateDailyPlanUsecase.execute({
          tasksText,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text:
            formatDailyPlan(outcome.result.plan, outcome.result.sources) +
            formatModelFooter(outcome),
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
        const outcome = await this.generateWorklogUsecase.execute({
          workText,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatDailyReview(outcome.result) + formatModelFooter(outcome),
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
        const outcome = await this.generateBackendPlanUsecase.execute({
          subject,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatBackendPlan(outcome.result) + formatModelFooter(outcome),
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
        const outcome = await this.generatePoShadowUsecase.execute({
          extraContext,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text:
            formatPoShadowReport(outcome.result) + formatModelFooter(outcome),
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
        const outcome = await this.generateImpactReportUsecase.execute({
          subject,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatImpactReport(outcome.result) + formatModelFooter(outcome),
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
      // /sync-context 는 PM `/today` 가 보는 5종 컨텍스트 (GitHub/Notion/Slack/직전 plan/직전 worklog) 를
      // 모델 호출 없이 다시 한번 점검만 한다. AgentRun 도 만들지 않고 푸터(modelUsed/run#) 도 없다.
      await ack({
        response_type: 'ephemeral',
        text: '이대리가 외부 컨텍스트를 재수집 중입니다 (5~15초 소요)...',
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

    app.command('/quota', async ({ ack, command, respond }) => {
      // OPS-1: /quota [today|week] — 사용자 자신의 agent_run 사용량 통계.
      // 인자 없으면 today 기본. 모델 호출 없이 DB groupBy 만 — 즉시 응답.
      const arg = command.text?.trim().toLowerCase() ?? '';
      const range: 'TODAY' | 'WEEK' = arg === 'week' ? 'WEEK' : 'TODAY';

      await ack({
        response_type: 'ephemeral',
        text: `이대리가 ${range === 'WEEK' ? '최근 7일' : '오늘'} 사용량을 집계 중입니다...`,
      });

      try {
        const stats = await this.getQuotaStatsUsecase.execute({
          slackUserId: command.user_id,
          range,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatQuotaStats(stats),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `GetQuotaStatsUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        const userFacingMessage =
          error instanceof DomainException
            ? rawMessage
            : '내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /quota 실패: ${userFacingMessage}`,
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
        const outcome = await this.reviewPullRequestUsecase.execute({
          prRef,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text:
            formatPullRequestReview({ prRef, review: outcome.result }) +
            formatModelFooter(outcome),
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

// Slack mrkdwn `<url|title>` 링크 안에 들어가는 텍스트가 `<` / `>` / `|` 를 포함하면 파싱이 깨진다.
// LLM 출력 (task.title) 이나 외부 CLI 결과 (modelUsed) 가 우연히 이 문자를 포함해도 footer/link 가 안 깨지도록
// 보수적으로 제거. 의미 손실은 미미하고 회귀 회피 효과 큼 (codex/omc P1 지적).
const sanitizeForSlackLink = (text: string): string =>
  text.replace(/[<>|]/g, '');

// Slack mrkdwn `<url|...>` 안의 url 은 반드시 http(s) 스킴이어야 한다.
// LLM 이 fragment(`/pull/707`) 만 반환하는 사고를 막기 위해 prefix 화이트리스트 (codex P0 지적).
const isSafeHttpUrl = (url: string): boolean =>
  url.startsWith('http://') || url.startsWith('https://');

// 모든 슬래시 명령 응답 끝에 붙는 공통 푸터 — 어떤 모델/run id 로 응답이 만들어졌는지 노출.
// PRO-3: 디버깅·품질 회고용 (어떤 provider 가 어떤 응답을 만들었는지 즉시 추적).
// agentRunId 는 DB 의 agent_run.id 와 1:1 매칭이라 사후 분석/Failure Replay 에 그대로 사용 가능.
// modelUsed 는 외부 CLI stdout 파싱 결과라 Slack mrkdwn 안전하게 sanitize.
export const formatModelFooter = ({
  modelUsed,
  agentRunId,
}: AgentRunOutcome<unknown>): string =>
  `\n\n_model: ${sanitizeForSlackLink(modelUsed)} · run #${agentRunId}_`;

// /quota 결과 — 사용자의 agent_run 사용량 통계 (provider 별 count + 평균/총 duration).
// 모델 호출 없는 DB 집계라 footer 미부착. since 시각은 ISO 그대로 노출 (사후 분석용).
export const formatQuotaStats = (stats: QuotaStatsResult): string => {
  const rangeLabel = stats.range === 'WEEK' ? '최근 7일' : '오늘 (24시간)';
  if (stats.totals.count === 0) {
    return [
      `*Quota 사용량 — ${rangeLabel}*`,
      '',
      `_${stats.sinceIso} 이후 본인 명의 agent_run 기록 없음._`,
    ].join('\n');
  }

  const lines: string[] = [
    `*Quota 사용량 — ${rangeLabel}*`,
    `_since ${stats.sinceIso}_`,
    '',
    '*Provider 별*',
  ];

  // count 내림차순 — 가장 많이 쓴 provider 가 위로.
  const sortedRows = [...stats.rows].sort((a, b) => b.count - a.count);
  for (const row of sortedRows) {
    const avgSec = (row.avgDurationMs / 1000).toFixed(1);
    const totalSec = (row.totalDurationMs / 1000).toFixed(1);
    lines.push(
      `• ${row.cliProvider} — ${row.count}회, 평균 ${avgSec}s · 총 ${totalSec}s`,
    );
  }

  const totalMin = (stats.totals.totalDurationMs / 60_000).toFixed(1);
  lines.push('', `*합계*: ${stats.totals.count}회 · 총 ${totalMin}분`);

  return lines.join('\n');
};

// /sync-context 결과 — 컨텍스트 재수집 상태 요약을 한국어 Slack 마크다운으로 렌더.
// 모델 호출이 없으므로 formatModelFooter 는 붙이지 않는다 (HOTFIX-1).
export const formatContextSummary = (summary: ContextSummary): string => {
  const githubLine = summary.github.fetchSucceeded
    ? `✅ Issue ${summary.github.issueCount}건 / PR ${summary.github.pullRequestCount}건`
    : `⚠ 수집 실패 (GITHUB_TOKEN 또는 권한 확인)`;

  const lines: string[] = [
    '*컨텍스트 재수집 결과*',
    '',
    `*GitHub*: ${githubLine}`,
    `*Notion*: 활성 task ${summary.notion.taskCount}건`,
    `*Slack*: 본인 멘션 ${summary.slack.mentionCount}건 (최근 ${summary.slack.sinceHours}h)`,
    '',
    summary.previousPlan
      ? `*직전 PM 실행*: #${summary.previousPlan.agentRunId} (${summary.previousPlan.endedAt.slice(0, 10)})`
      : '*직전 PM 실행*: 없음',
    summary.previousWorklog
      ? `*직전 Work Reviewer 실행*: #${summary.previousWorklog.agentRunId} (${summary.previousWorklog.endedAt.slice(0, 10)})`
      : '*직전 Work Reviewer 실행*: 없음',
  ];

  return lines.join('\n');
};

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

// DailyPlan 결과 위에 노출할 "참조 소스" 섹션 — /today 응답 맨 위에 섞인다.
// 사용자가 plan 이 어떤 데이터에 근거해 만들어졌는지 즉시 확인할 수 있도록 제목 + URL 을 노출한다.
const formatSourceReferences = (sources: DailyPlanSource[]): string[] => {
  if (sources.length === 0) {
    return [];
  }
  return [
    '*참조 소스*',
    ...sources.map((src) => {
      const linked =
        src.url && isSafeHttpUrl(src.url)
          ? ` (<${sanitizeForSlackLink(src.url)}|링크>)`
          : '';
      return `• ${src.label}${linked}`;
    }),
    '',
  ];
};

// lineage 라벨 prefix — PRO-2 의 어제↔오늘 추적성을 한눈에 보여줌. 라벨 없는 구버전 plan 은 prefix 생략.
const LINEAGE_LABEL: Record<NonNullable<TaskItem['lineage']>, string> = {
  NEW: '🆕 ',
  CARRIED: '🔁 ',
  POSTPONED: '⏭ ',
};

// url 이 있으면 Slack 마크다운 링크로 감싸 PR/Issue/Notion 으로 즉시 이동 가능 (PRO-2+ 이슈 A).
// http(s) 스킴이 아니면 broken link 회피 위해 단순 텍스트로 fallback (codex P0 지적).
// title/url 둘 다 mrkdwn-safe 로 sanitize 해 `|` / `>` / `<` 가 섞여도 링크 파싱 안 깨짐.
const renderTitleWithLink = (task: TaskItem): string => {
  if (task.url && task.url.length > 0 && isSafeHttpUrl(task.url)) {
    return `<${sanitizeForSlackLink(task.url)}|${sanitizeForSlackLink(task.title)}>`;
  }
  return task.title;
};

const renderTaskLine = (task: TaskItem): string => {
  const critical = task.isCriticalPath ? '⚠ ' : '';
  const lineage = task.lineage ? LINEAGE_LABEL[task.lineage] : '';
  const titled = renderTitleWithLink(task);
  const wbs =
    task.subtasks.length > 0
      ? `\n${task.subtasks
          .map((s) => `   ↳ ${s.title} (${s.estimatedMinutes}m)`)
          .join('\n')}`
      : '';
  return `• ${lineage}${critical}${titled}${wbs}`;
};

export const formatDailyPlan = (
  plan: DailyPlan,
  sources: DailyPlanSource[] = [],
): string => {
  const lines: string[] = [
    ...formatSourceReferences(sources),
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
