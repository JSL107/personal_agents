import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GithubModule } from '../github/github.module';
import { LocalSessionsModule } from '../local-sessions/local-sessions.module';
import { DispatchCooldown } from './application/dispatch-cooldown';
import { GithubEventBridge } from './application/github-event.bridge';
import { IdleTransitionWatcher } from './application/idle-transition.watcher';
import { SessionDispatchService } from './application/session-dispatch.service';

const DEFAULT_SESSION_DISPATCH_COOLDOWN_MS = 1_800_000;

@Module({
  imports: [GithubModule, LocalSessionsModule],
  providers: [
    SessionDispatchService,
    GithubEventBridge,
    IdleTransitionWatcher,
    {
      provide: DispatchCooldown,
      useFactory: (configService: ConfigService): DispatchCooldown => {
        const cooldownMs = Number(
          configService.get<string>('SESSION_DISPATCH_COOLDOWN_MS') ??
            DEFAULT_SESSION_DISPATCH_COOLDOWN_MS,
        );
        return new DispatchCooldown(cooldownMs, () => Date.now());
      },
      inject: [ConfigService],
    },
  ],
  exports: [GithubEventBridge, SessionDispatchService],
})
export class SessionDispatchModule {}
