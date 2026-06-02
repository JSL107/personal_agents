import { Module } from '@nestjs/common';

import { NotionModule } from '../notion/notion.module';
import { AppendPushpinTaskService } from './application/append-pushpin-task.service';

@Module({
  imports: [NotionModule],
  providers: [AppendPushpinTaskService],
  exports: [AppendPushpinTaskService],
})
export class PushpinTaskModule {}
