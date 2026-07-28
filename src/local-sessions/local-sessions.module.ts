import { Module } from '@nestjs/common';

import {
  defaultLocalSessionConfig,
  LOCAL_SESSION_CONFIG,
  LocalSessionService,
} from './application/local-session.service';

// 로컬 CLI 세션(Claude/Codex) 조회 모듈 — 파일 조회만, 부작용 0.
@Module({
  providers: [
    { provide: LOCAL_SESSION_CONFIG, useFactory: defaultLocalSessionConfig },
    LocalSessionService,
  ],
  exports: [LocalSessionService],
})
export class LocalSessionsModule {}
