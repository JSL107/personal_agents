import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GithubModule } from '../../github/github.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { NotionModule } from '../../notion/notion.module';
import { SlackCollectorModule } from '../../slack-collector/slack-collector.module';
import { GeneratePoShadowUsecase } from './application/generate-po-shadow.usecase';
import { PoShadowContextCollector } from './application/po-shadow-context.collector';
import { PoShadowDispatcher } from './infrastructure/po-shadow.dispatcher';

@Module({
  imports: [
    ModelRouterModule,
    AgentRunModule,
    GithubModule,
    SlackCollectorModule,
    NotionModule,
  ],
  providers: [
    GeneratePoShadowUsecase,
    PoShadowContextCollector,
    PoShadowDispatcher,
  ],
  exports: [GeneratePoShadowUsecase, PoShadowDispatcher],
})
export class PoShadowModule {}
