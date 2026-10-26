import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { BlogModule } from '../blog/blog.module';
import { RunHumanizeResearchUsecase } from './application/run-humanize-research.usecase';
import { ArxivAbstractCollector } from './infrastructure/collectors/arxiv-abstract.collector';
import { BlogRevisionCollector } from './infrastructure/collectors/blog-revision.collector';
import { HumanizerSignalsCollector } from './infrastructure/collectors/humanizer-signals.collector';
import { UpstreamRuleDiffCollector } from './infrastructure/collectors/upstream-rule-diff.collector';
import { ModelSampleCollector } from './infrastructure/model-sample.collector';

@Module({
  imports: [AgentRunModule, BlogModule, ModelRouterModule],
  providers: [
    RunHumanizeResearchUsecase,
    HumanizerSignalsCollector,
    BlogRevisionCollector,
    UpstreamRuleDiffCollector,
    ArxivAbstractCollector,
    ModelSampleCollector,
  ],
  exports: [RunHumanizeResearchUsecase],
})
export class HumanizeResearchModule {}
