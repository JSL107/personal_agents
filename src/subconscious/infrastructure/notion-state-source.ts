import { Inject, Injectable } from '@nestjs/common';

import type { NotionClientPort } from '../../notion/domain/port/notion-client.port';
import { NOTION_CLIENT_PORT } from '../../notion/domain/port/notion-client.port';
import { StateSource } from '../domain/port/state-source.port';
import { StateSnapshot } from '../domain/subconscious.type';
import { buildSnapshot, sha } from './snapshot.util';

@Injectable()
export class NotionStateSource implements StateSource {
  readonly id = 'notion';

  // 여기서는 ListActiveTasksUsecase 를 쓰지 않는다 — PM / PO Shadow 와 달리 일부러 컷오프를 안 건다.
  // STALE_DATA_CUTOFF_DAYS 는 실행 시각마다 다시 계산되는 이동 창이라, 조회에 걸면 항목이
  // 마지막 편집 후 N일 선을 넘는 날의 tick 에서 결과에서 빠지고 diffSnapshots 가 그것을 실제
  // removed 로 판정한다. 나이 먹은 것이 지워진 것으로 둔갑해 gate 호출·제안 카드가 뜨고 baseline 도
  // 삭제 상태로 전진한다. prompt 는 분량 상한이 있어 컷오프가 필요하지만 여기는 상태 비교라 필요 없다 —
  // 묵은 항목은 지문이 그대로라 contentHash 가 같고, diffSnapshots 가 빈 배열로 즉시 반환한다.
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
