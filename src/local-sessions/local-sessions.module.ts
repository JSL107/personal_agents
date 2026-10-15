import { Module } from '@nestjs/common';

import {
  defaultLocalSessionConfig,
  LOCAL_SESSION_CONFIG,
  LocalSessionService,
} from './application/local-session.service';
import {
  defaultInjectEnqueueDeps,
  INJECT_ENQUEUE_DEPS,
  SessionInjectService,
} from './application/session-inject.service';
import {
  defaultWorkSessionDigestConfig,
  WORK_SESSION_DIGEST_CONFIG,
  WorkSessionDigestService,
} from './application/work-session-digest.service';

// 로컬 CLI 세션(Claude/Codex) 조회 + inject 큐잉 모듈. 조회는 부작용 0, inject 는 파일 큐 쓰기.
@Module({
  providers: [
    { provide: LOCAL_SESSION_CONFIG, useFactory: defaultLocalSessionConfig },
    { provide: INJECT_ENQUEUE_DEPS, useFactory: defaultInjectEnqueueDeps },
    LocalSessionService,
    SessionInjectService,
    {
      provide: WORK_SESSION_DIGEST_CONFIG,
      useFactory: defaultWorkSessionDigestConfig,
    },
    WorkSessionDigestService,
  ],
  exports: [
    LocalSessionService,
    SessionInjectService,
    WorkSessionDigestService,
  ],
})
export class LocalSessionsModule {}
