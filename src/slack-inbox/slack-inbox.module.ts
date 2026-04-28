import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { SlackInboxService } from './application/slack-inbox.service';
import { SLACK_INBOX_REPOSITORY_PORT } from './domain/port/slack-inbox.repository.port';
import { SlackInboxPrismaRepository } from './infrastructure/slack-inbox.prisma.repository';

@Module({
  imports: [PrismaModule],
  providers: [
    SlackInboxService,
    {
      provide: SLACK_INBOX_REPOSITORY_PORT,
      useClass: SlackInboxPrismaRepository,
    },
  ],
  exports: [SlackInboxService],
})
export class SlackInboxModule {}
