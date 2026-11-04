import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@notionhq/client';

import { AppendDailyPlanUsecase } from './application/append-daily-plan.usecase';
import { AppendWorklogUsecase } from './application/append-worklog.usecase';
import { ListActiveTasksUsecase } from './application/list-active-tasks.usecase';
import {
  NOTION_CLIENT_INSTANCE,
  NOTION_CLIENT_PORT,
  NOTION_WORK_CLIENT_INSTANCE,
} from './domain/port/notion-client.port';
import { NotionApiClient } from './infrastructure/notion-api.client';

@Module({
  providers: [
    ListActiveTasksUsecase,
    AppendDailyPlanUsecase,
    AppendWorklogUsecase,
    {
      // Notion Client factory — NOTION_TOKEN 미설정 시 null. 호출 시점에 친절한 예외.
      provide: NOTION_CLIENT_INSTANCE,
      useFactory: (configService: ConfigService): Client | null => {
        const token = configService.get<string>('NOTION_TOKEN');
        if (!token) {
          return null;
        }
        return new Client({ auth: token });
      },
      inject: [ConfigService],
    },
    {
      provide: NOTION_WORK_CLIENT_INSTANCE,
      useFactory: (configService: ConfigService): Client | null => {
        const token = configService.get<string>('NOTION_WORK_TOKEN');
        if (!token) {
          return null;
        }
        return new Client({ auth: token });
      },
      inject: [ConfigService],
    },
    {
      provide: NOTION_CLIENT_PORT,
      useClass: NotionApiClient,
    },
  ],
  exports: [
    ListActiveTasksUsecase,
    AppendDailyPlanUsecase,
    AppendWorklogUsecase,
    // PM-2: PmWriteBackApplier 가 PreviewGateModule.forRoot 안에서 NOTION_CLIENT_PORT 를 inject 받기 위해 노출.
    NOTION_CLIENT_PORT,
  ],
})
export class NotionModule {}
