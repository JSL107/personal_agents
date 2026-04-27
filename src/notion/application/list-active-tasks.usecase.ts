import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { resolveStaleDataCutoff } from '../../common/util/stale-data-cutoff.util';
import { NotionTask } from '../domain/notion.type';
import {
  ListActiveTasksOptions,
  NOTION_CLIENT_PORT,
  NotionClientPort,
} from '../domain/port/notion-client.port';

// 설정된 Notion task DB(들)에서 page row 들을 조회 — PM Agent 가 evidence 로 활용.
// OPS-6: 호출자가 lastEditedSinceIsoDateTime 을 명시 안 하면 STALE_DATA_CUTOFF_DAYS env 기반 컷오프를 자동 적용 —
// archive 안 된 long-tail Notion task 가 매일 prompt 에 누적되는 것을 차단.
@Injectable()
export class ListActiveTasksUsecase {
  constructor(
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly configService: ConfigService,
  ) {}

  async execute(options?: ListActiveTasksOptions): Promise<NotionTask[]> {
    const cutoff = resolveStaleDataCutoff({
      configService: this.configService,
    });
    return this.notionClient.listActiveTasks({
      ...options,
      lastEditedSinceIsoDateTime:
        options?.lastEditedSinceIsoDateTime ?? cutoff.isoDateTime,
    });
  }
}
