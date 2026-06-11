import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GenerateBlogDraftUsecase } from './application/generate-blog-draft.usecase';
import { HERMES_RUNNER_PORT } from './domain/port/hermes-runner.port';
import { BlogDispatcher } from './infrastructure/blog.dispatcher';
import { HermesCliRunner } from './infrastructure/hermes-cli.runner';

// BLOG 릴레이 모듈. model-router 미경유(Hermes 가 모델 자체 선택) → ModelRouterModule import 불필요.
// dispatcher 를 export 해 RouterModule 의 AGENT_DISPATCHER_PORT useFactory 가 inject 가능하게 한다.
@Module({
  imports: [AgentRunModule],
  providers: [
    GenerateBlogDraftUsecase,
    BlogDispatcher,
    { provide: HERMES_RUNNER_PORT, useClass: HermesCliRunner },
  ],
  exports: [GenerateBlogDraftUsecase, BlogDispatcher],
})
export class BlogModule {}
