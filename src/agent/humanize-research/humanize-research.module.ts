import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { BlogModule } from '../blog/blog.module';
import { RunHumanizeResearchUsecase } from './application/run-humanize-research.usecase';
import { CanonCheckRunner } from './infrastructure/canon-check.runner';
import { ArxivAbstractCollector } from './infrastructure/collectors/arxiv-abstract.collector';
import { BlogRevisionCollector } from './infrastructure/collectors/blog-revision.collector';
import { CanonLogCollector } from './infrastructure/collectors/canon-log.collector';
import { HumanizerSignalsCollector } from './infrastructure/collectors/humanizer-signals.collector';
import { UpstreamRuleDiffCollector } from './infrastructure/collectors/upstream-rule-diff.collector';

@Module({
  imports: [AgentRunModule, BlogModule, ModelRouterModule],
  providers: [
    RunHumanizeResearchUsecase,
    CanonCheckRunner,
    HumanizerSignalsCollector,
    BlogRevisionCollector,
    UpstreamRuleDiffCollector,
    ArxivAbstractCollector,
    CanonLogCollector,
  ],
  exports: [RunHumanizeResearchUsecase, CanonCheckRunner],
})
export class HumanizeResearchModule {}
