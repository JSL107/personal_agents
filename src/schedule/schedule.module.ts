import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';

import { AgentRunModule } from '../agent-run/agent-run.module';
import { LoopbackOnlyGuard } from '../common/guard/loopback-only.guard';
import { ConsoleEventBus } from '../console/application/console-event-bus.service';
import { ConsoleReadGuard } from '../console/interface/console-read.guard';
import { FactAnswerModule } from '../fact-answer/fact-answer.module';
import { GithubModule } from '../github/github.module';
import { ModelRouterModule } from '../model-router/model-router.module';
import { NotionModule } from '../notion/notion.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AnswerScheduleQuestionUsecase } from './application/answer-schedule-question.usecase';
import { BuildEveningTodoSummaryUsecase } from './application/build-evening-todo-summary.usecase';
import { BuildMorningTodosUsecase } from './application/build-morning-todos.usecase';
import { CloseFinishedIssuesUsecase } from './application/close-finished-issues.usecase';
import { CloseFinishedNotionTasksUsecase } from './application/close-finished-notion-tasks.usecase';
import { DeleteScheduleUsecase } from './application/delete-schedule.usecase';
import { DraftFollowUpMessageUsecase } from './application/draft-follow-up-message.usecase';
import { ExtractScheduleFromConversationUsecase } from './application/extract-schedule-from-conversation.usecase';
import { GenerateShortTitlesUsecase } from './application/generate-short-titles.usecase';
import { JudgeMentionRequestUsecase } from './application/judge-mention-request.usecase';
import { ListSchedulesUsecase } from './application/list-schedules.usecase';
import { ManageScheduleFromConversationUsecase } from './application/manage-schedule-from-conversation.usecase';
import { MarkScheduleAsHolidayUsecase } from './application/mark-schedule-as-holiday.usecase';
import { ReconcilePullRequestsUsecase } from './application/reconcile-pull-requests.usecase';
import { RegisterConsoleScheduleUsecase } from './application/register-console-schedule.usecase';
import { RegisterScheduleUsecase } from './application/register-schedule.usecase';
import { ResolveWorkTurnsUsecase } from './application/resolve-work-turns.usecase';
import { ScheduleFollowUpUsecase } from './application/schedule-follow-up.usecase';
import { UpdateScheduleUsecase } from './application/update-schedule.usecase';
import { UpdateScheduleFieldsUsecase } from './application/update-schedule-fields.usecase';
import { UpdateScheduleStatusUsecase } from './application/update-schedule-status.usecase';
import { DAILY_TODO_REPOSITORY_PORT } from './domain/port/daily-todo.repository.port';
import { SCHEDULE_REPOSITORY_PORT } from './domain/port/schedule.repository.port';
import { SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT } from './domain/port/schedule-collection-state.repository.port';
import { SCHEDULE_NOTIFIER_PORT } from './domain/port/schedule-notifier.port';
import { DailyTodoPrismaRepository } from './infrastructure/daily-todo.prisma.repository';
import { notifyOnScheduleWrite } from './infrastructure/notify-on-schedule-write';
import { ScheduleDispatcher } from './infrastructure/schedule.dispatcher';
import { SchedulePrismaRepository } from './infrastructure/schedule.prisma.repository';
import { ScheduleCollectionStatePrismaRepository } from './infrastructure/schedule-collection-state.prisma.repository';
import {
  SCHEDULE_SLACK_CLIENT_OPTIONS,
  SCHEDULE_SLACK_WEB_CLIENT,
  ScheduleSlackNotifier,
} from './infrastructure/schedule-slack.notifier';
import { ScheduleConsoleController } from './interface/schedule-console.controller';

@Module({
  imports: [
    AgentRunModule,
    FactAnswerModule,
    GithubModule,
    NotionModule,
    PrismaModule,
    ModelRouterModule,
  ],
  controllers: [ScheduleConsoleController],
  providers: [
    {
      provide: DAILY_TODO_REPOSITORY_PORT,
      useClass: DailyTodoPrismaRepository,
    },
    SchedulePrismaRepository,
    {
      // 일정 내용은 SSE 에 싣지 않는다. 바뀌었다는 신호만 보내 콘솔 캘린더가 다시 읽게 한다.
      provide: SCHEDULE_REPOSITORY_PORT,
      // eslint-disable-next-line no-restricted-syntax -- Nest 는 inject 순서대로 인자를 넣는다
      useFactory: (
        repository: SchedulePrismaRepository,
        eventBus: ConsoleEventBus,
      ) =>
        notifyOnScheduleWrite({
          repository,
          onChanged: () => eventBus.publish({ type: 'schedule.changed' }),
        }),
      inject: [SchedulePrismaRepository, ConsoleEventBus],
    },
    {
      provide: SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT,
      useClass: ScheduleCollectionStatePrismaRepository,
    },
    ExtractScheduleFromConversationUsecase,
    CloseFinishedIssuesUsecase,
    CloseFinishedNotionTasksUsecase,
    ReconcilePullRequestsUsecase,
    ResolveWorkTurnsUsecase,
    BuildMorningTodosUsecase,
    BuildEveningTodoSummaryUsecase,
    GenerateShortTitlesUsecase,
    JudgeMentionRequestUsecase,
    RegisterScheduleUsecase,
    RegisterConsoleScheduleUsecase,
    ListSchedulesUsecase,
    AnswerScheduleQuestionUsecase,
    ManageScheduleFromConversationUsecase,
    MarkScheduleAsHolidayUsecase,
    UpdateScheduleStatusUsecase,
    UpdateScheduleFieldsUsecase,
    UpdateScheduleUsecase,
    ScheduleFollowUpUsecase,
    DeleteScheduleUsecase,
    DraftFollowUpMessageUsecase,
    ScheduleDispatcher,
    { provide: SCHEDULE_NOTIFIER_PORT, useClass: ScheduleSlackNotifier },
    ConsoleReadGuard,
    LoopbackOnlyGuard,
    // 토큰이 없으면 null 을 주입하고 notifier 가 발송을 건너뛴다 — 여기서 throw 하면
    // Slack 을 붙이지 않은 환경에서 모듈 전체가 뜨지 않아 일정 조회까지 같이 죽는다.
    // `BlogModule` 의 `BLOG_SLACK_WEB_CLIENT` 와 같은 처리다.
    {
      provide: SCHEDULE_SLACK_WEB_CLIENT,
      useFactory: (configService: ConfigService): WebClient | null => {
        const token = configService.get<string>('SLACK_BOT_TOKEN');
        if (!token) {
          return null;
        }
        // 옵션은 notifier 가 소유한다 — 여기에 숫자를 따로 적으면 "왜 3초인가" 가 적힌
        // 곳과 실제로 쓰이는 곳이 갈라지고, 한쪽만 바뀐다.
        return new WebClient(token, SCHEDULE_SLACK_CLIENT_OPTIONS);
      },
      inject: [ConfigService],
    },
  ],
  exports: [
    GenerateShortTitlesUsecase,
    CloseFinishedIssuesUsecase,
    CloseFinishedNotionTasksUsecase,
    ReconcilePullRequestsUsecase,
    ResolveWorkTurnsUsecase,
    BuildMorningTodosUsecase,
    BuildEveningTodoSummaryUsecase,
    DAILY_TODO_REPOSITORY_PORT,
    RegisterScheduleUsecase,
    ListSchedulesUsecase,
    MarkScheduleAsHolidayUsecase,
    UpdateScheduleStatusUsecase,
    UpdateScheduleFieldsUsecase,
    ScheduleFollowUpUsecase,
    DeleteScheduleUsecase,
    DraftFollowUpMessageUsecase,
    JudgeMentionRequestUsecase,
    SCHEDULE_REPOSITORY_PORT,
    SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT,
    ScheduleDispatcher,
  ],
})
export class ScheduleModule {}
