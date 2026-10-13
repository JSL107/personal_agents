import { EventEmitter } from 'node:events';

import { Logger } from '@nestjs/common';
import { MetadataScanner } from '@nestjs/core';
import { Job } from 'bullmq';

import { ObservedWorkerHost } from './observed-worker-host';

// @nestjs/bullmq 내부 상수(bull.constants.js ON_WORKER_EVENT_METADATA) — index 로 export 되지 않는다.
const ON_WORKER_EVENT_METADATA = 'bullmq:worker_events_metadata';

class SampleConsumer extends ObservedWorkerHost {
  async process(): Promise<void> {}
}

describe('ObservedWorkerHost', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('상속한 consumer 의 worker 가 stalled 를 내면 queue·job.name·job.id 를 warn 으로 남긴다', async () => {
    const consumer = new SampleConsumer();
    const worker = Object.assign(new EventEmitter(), {
      name: 'autopilot-cron',
    });
    (consumer as unknown as { _worker: unknown })._worker = worker;
    jest
      .spyOn(Job, 'fromId')
      .mockResolvedValue({ name: 'pr-review-sweep' } as Job);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    // BullExplorer.registerWorkerEventListeners 와 같은 경로 — prototype chain 을 훑어 핸들러를 건다.
    const prototype = Object.getPrototypeOf(consumer) as object;
    let stalledHandler: ((jobId: string) => Promise<void>) | undefined;
    new MetadataScanner().scanFromPrototype(consumer, prototype, (key) => {
      const method = (consumer as unknown as Record<string, () => unknown>)[
        key
      ];
      const metadata = Reflect.getMetadata(ON_WORKER_EVENT_METADATA, method) as
        | { eventName: string }
        | undefined;
      if (metadata?.eventName === 'stalled') {
        stalledHandler = method.bind(consumer) as typeof stalledHandler;
        worker.on('stalled', stalledHandler!);
      }
    });
    expect(stalledHandler).toBeDefined();

    worker.emit('stalled', 'repeat:abc:1760317980000', 'active');
    // 핸들러는 async(Job.fromId 조회) 라 emit 이 기다리지 않는다 — 한 틱 넘겨 로그를 확인한다.
    await new Promise((resolve) => setImmediate(resolve));

    expect(warn).toHaveBeenCalledWith(
      'stalled 회수 — queue=autopilot-cron job.name=pr-review-sweep job.id=repeat:abc:1760317980000',
    );
  });
});
