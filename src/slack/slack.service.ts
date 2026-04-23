import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, LogLevel } from '@slack/bolt';

import { GenerateDailyPlanUsecase } from '../agent/pm/application/generate-daily-plan.usecase';
import { DailyPlan } from '../agent/pm/domain/pm-agent.type';
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
  }
}

export const formatDailyPlan = (plan: DailyPlan): string => {
  const lines: string[] = [
    '*오늘의 최우선 과제*',
    `• ${plan.topPriority}`,
    '',
    '*오전*',
    ...plan.morning.map((task) => `• ${task}`),
    '',
    '*오후*',
    ...plan.afternoon.map((task) => `• ${task}`),
  ];

  if (plan.blocker) {
    lines.push('', `*Blocker*: ${plan.blocker}`);
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
