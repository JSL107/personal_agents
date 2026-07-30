import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GithubModule } from '../github/github.module';
import { DispatchCooldown } from './application/dispatch-cooldown';
import { IdleTransitionWatcher } from './application/idle-transition.watcher';
import { SessionDispatchService } from './application/session-dispatch.service';

const DEFAULT_SESSION_DISPATCH_COOLDOWN_MS = 1_800_000;

@Module({
  imports: [GithubModule],
  providers: [
    SessionDispatchService,
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
})
export class SessionDispatchModule {}
