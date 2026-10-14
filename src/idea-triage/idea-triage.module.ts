import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';

import { AgentRunModule } from '../agent-run/agent-run.module';
import { HolidayModule } from '../holiday/holiday.module';
import { ModelRouterModule } from '../model-router/model-router.module';
import { SLACK_NOTIFIER_PORT } from '../slack/domain/port/slack-notifier.port';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { SLACK_WEB_CLIENT } from '../slack-collector/domain/port/slack-collector.port';
import { JudgeIdeaUsecase } from './application/judge-idea.usecase';
import { TriageIdeaChannelUsecase } from './application/triage-idea-channel.usecase';
import { IDEA_CHANNEL_READER_PORT } from './domain/port/idea-channel-reader.port';
import { IDEA_TRIAGE_REPOSITORY_PORT } from './domain/port/idea-triage.repository.port';
import { IdeaChannelSlackReader } from './infrastructure/idea-channel.slack-reader';
import { IdeaTriagePrismaRepository } from './infrastructure/idea-triage.prisma.repository';

@Module({
  imports: [AgentRunModule, ModelRouterModule, HolidayModule, SlackModule],
  providers: [
    JudgeIdeaUsecase,
    TriageIdeaChannelUsecase,
    {
      provide: IDEA_TRIAGE_REPOSITORY_PORT,
      useClass: IdeaTriagePrismaRepository,
    },
    { provide: IDEA_CHANNEL_READER_PORT, useClass: IdeaChannelSlackReader },
    { provide: SLACK_NOTIFIER_PORT, useExisting: SlackService },
    {
      provide: SLACK_WEB_CLIENT,
      useFactory: (configService: ConfigService): WebClient | null => {
        const token = configService.get<string>('SLACK_BOT_TOKEN');
        return token ? new WebClient(token) : null;
      },
      inject: [ConfigService],
    },
  ],
  exports: [TriageIdeaChannelUsecase, IDEA_TRIAGE_REPOSITORY_PORT],
})
export class IdeaTriageModule {}
