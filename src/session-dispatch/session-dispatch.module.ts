import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../github/domain/port/github-client.port';
import { GithubModule } from '../github/github.module';
import { LocalSessionsModule } from '../local-sessions/local-sessions.module';
import { CreatePreviewUsecase } from '../preview-gate/application/create-preview.usecase';
import { FindAllOpenPreviewsUsecase } from '../preview-gate/application/find-all-open-previews.usecase';
import { DispatchCooldown } from './application/dispatch-cooldown';
import { GithubEventBridge } from './application/github-event.bridge';
import { IdleTransitionWatcher } from './application/idle-transition.watcher';
import { defaultResolveRepo } from './application/resolve-repo';
import { SessionDispatchService } from './application/session-dispatch.service';

const DEFAULT_SESSION_DISPATCH_COOLDOWN_MS = 1_800_000;

@Module({
  imports: [GithubModule, LocalSessionsModule],
  providers: [
    {
      provide: SessionDispatchService,
      useFactory: (
        configService: ConfigService,
        githubClient: GithubClientPort,
        createPreview: CreatePreviewUsecase,
        findAllOpenPreviews: FindAllOpenPreviewsUsecase,
        cooldown: DispatchCooldown,
      ): SessionDispatchService =>
        new SessionDispatchService(
          configService,
          githubClient,
          createPreview,
          findAllOpenPreviews,
          cooldown,
          defaultResolveRepo,
        ),
      inject: [
        ConfigService,
        GITHUB_CLIENT_PORT,
        CreatePreviewUsecase,
        FindAllOpenPreviewsUsecase,
        DispatchCooldown,
      ],
    },
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
