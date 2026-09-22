import { Injectable } from '@nestjs/common';

import { ListActiveTasksUsecase } from '../../notion/application/list-active-tasks.usecase';
import { StateSource } from '../domain/port/state-source.port';
import { StateSnapshot } from '../domain/subconscious.type';
import { buildSnapshot, sha } from './snapshot.util';

@Injectable()
export class NotionStateSource implements StateSource {
  readonly id = 'notion';

  // NOTION_CLIENT_PORT 를 직접 주입하면 OPS-6 의 stale 컷오프를 건너뛴다 — PM / PO Shadow 는
  // ListActiveTasksUsecase 를 거쳐 STALE_DATA_CUTOFF_DAYS 를 적용받는데 여기만 포트를 직접 불러
  // 수개월 전 항목까지 매 tick baseline 에 실렸다. 세 소비처가 같은 컷오프를 보도록 usecase 로 맞춘다.
  constructor(
    private readonly listActiveTasksUsecase: ListActiveTasksUsecase,
  ) {}

  async fetchSnapshot(): Promise<StateSnapshot> {
    const tasks = await this.listActiveTasksUsecase.execute();

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
