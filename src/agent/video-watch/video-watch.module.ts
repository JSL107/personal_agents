import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { WatchVideoUsecase } from './application/watch-video.usecase';
import { WATCH_RUNNER_PORT } from './domain/port/watch-runner.port';
import { VideoWatchDispatcher } from './infrastructure/video-watch.dispatcher';
import { WatchCliRunner } from './infrastructure/watch-cli.runner';

@Module({
  imports: [AgentRunModule, ModelRouterModule],
  providers: [
    WatchVideoUsecase,
    VideoWatchDispatcher,
    WatchCliRunner,
    { provide: WATCH_RUNNER_PORT, useExisting: WatchCliRunner },
  ],
  exports: [WatchVideoUsecase, VideoWatchDispatcher],
})
export class VideoWatchModule {}
