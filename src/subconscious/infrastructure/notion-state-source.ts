import { Inject, Injectable } from '@nestjs/common';

import type { NotionClientPort } from '../../notion/domain/port/notion-client.port';
import { NOTION_CLIENT_PORT } from '../../notion/domain/port/notion-client.port';
import { StateSource } from '../domain/port/state-source.port';
import { StateSnapshot } from '../domain/subconscious.type';
import { buildSnapshot, sha } from './snapshot.util';

@Injectable()
export class NotionStateSource implements StateSource {
  readonly id = 'notion';

  constructor(
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
  ) {}

  async fetchSnapshot(): Promise<StateSnapshot> {
    const tasks = await this.notionClient.listActiveTasks();

    const items = tasks.map((task) => {
      const status = task.properties['상태'] ?? task.properties['Status'] ?? '';
      return {
        key: `notion:${task.pageId}`,
        fingerprint: sha(`${status}|${task.title}`),
        summary: task.title,
      };
    });

    return buildSnapshot(this.id, items);
  }
}
