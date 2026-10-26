import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { buildContractPreamble } from '../../../agent-registry/agent-contract';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { expandHomePath } from '../../../common/util/expand-home-path.util';
import { DEFAULT_HUMANIZE_RULES_REPO_PATH } from '../../../humanize/domain/humanize-rules-repository';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  CollectionResult,
  CollectionStatus,
  HumanizeResearchOutput,
  HumanizeResearchSource,
  Processed,
} from '../domain/humanize-research.type';
import {
  advanceProcessed,
  selectResearchInput,
} from '../domain/humanize-research-input';
import {
  constrainResearchProposals,
  parseResearchOutput,
} from '../domain/humanize-research-output';
import {
  HUMANIZE_RESEARCH_OUTPUT_SCHEMA,
  HUMANIZE_RESEARCH_SYSTEM_PROMPT,
} from '../domain/prompt/humanize-research.prompt';
import { ArxivAbstractCollector } from '../infrastructure/collectors/arxiv-abstract.collector';
import { BlogRevisionCollector } from '../infrastructure/collectors/blog-revision.collector';
import { HumanizerSignalsCollector } from '../infrastructure/collectors/humanizer-signals.collector';
import { UpstreamRuleDiffCollector } from '../infrastructure/collectors/upstream-rule-diff.collector';
import { ModelSampleCollector } from '../infrastructure/model-sample.collector';

const EMPTY_PROCESSED: Processed = {
  humanizerMaxRunId: null,
  blogPostIds: [],
  upstreamHead: null,
  arxivIds: [],
};

export interface HumanizeResearchRunResult {
  output: HumanizeResearchOutput;
  modelUsed: string;
  skippedForNoSources: boolean;
}

const readProcessed = (value: unknown): Processed | null => {
  const isObject = typeof value === 'object' && value !== null;
  if (!isObject || Array.isArray(value)) {
    return null;
  }
  const record = (value as Record<string, unknown>).processed;
  const valid = typeof record === 'object' && record !== null;
  if (!valid || Array.isArray(record)) {
    return null;
  }
  const processed = record as Record<string, unknown>;
  const humanizerMaxRunId = processed.humanizerMaxRunId;
  const upstreamHead = processed.upstreamHead;
  const blogPostIds = processed.blogPostIds;
  const arxivIds = processed.arxivIds;
  const idValid =
    humanizerMaxRunId === null || typeof humanizerMaxRunId === 'string';
  const headValid = upstreamHead === null || typeof upstreamHead === 'string';
  const blogValid =
    Array.isArray(blogPostIds) &&
    blogPostIds.every((id) => typeof id === 'string');
  const arxivValid =
    Array.isArray(arxivIds) && arxivIds.every((id) => typeof id === 'string');
  if (!idValid || !headValid || !blogValid || !arxivValid) {
    return null;
  }
  return processed as unknown as Processed;
};

@Injectable()
export class RunHumanizeResearchUsecase {
  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly modelRouter: ModelRouterUsecase,
    private readonly configService: ConfigService,
    private readonly humanizer: HumanizerSignalsCollector,
    private readonly blog: BlogRevisionCollector,
    private readonly upstream: UpstreamRuleDiffCollector,
    private readonly arxiv: ArxivAbstractCollector,
    private readonly samples: ModelSampleCollector,
  ) {}

  async execute(): Promise<HumanizeResearchRunResult> {
    const outcome =
      await this.agentRunService.execute<HumanizeResearchRunResult>({
        agentType: AgentType.HUMANIZE_RESEARCH,
        triggerType: TriggerType.WEEKLY_HUMANIZE_RESEARCH_CRON,
        inputSnapshot: { lookbackDays: 28, inputLimit: 60_000 },
        run: async (context) => {
          const history = await this.agentRunService.findRecentSucceededRuns({
            agentType: AgentType.HUMANIZE_RESEARCH,
            sinceDays: 180,
            limit: 5,
          });
          const previous = readProcessed(history[0]?.output) ?? EMPTY_PROCESSED;
          const recentArxivIds = history.flatMap(
            (run) => readProcessed(run.output)?.arxivIds ?? [],
          );
          const collectorInput = {
            ...previous,
            arxivIds: [...new Set(recentArxivIds)],
          };
          const sources = await Promise.all([
            this.collectSafely(HumanizeResearchSource.HUMANIZER, () =>
              this.humanizer.collect(previous),
            ),
            this.collectSafely(HumanizeResearchSource.BLOG, () =>
              this.blog.collect(previous),
            ),
            this.collectSafely(HumanizeResearchSource.UPSTREAM, () =>
              this.upstream.collect(previous),
            ),
            this.collectSafely(HumanizeResearchSource.ARXIV, () =>
              this.arxiv.collect(collectorInput),
            ),
            this.collectSafely(HumanizeResearchSource.SAMPLE, () =>
              this.samples.collect(),
            ),
          ]);
          const items = sources.flatMap((source) => source.items);
          const sourceStatus = sources.map(
            ({ source, status, items: sourceItems, error }) => ({
              source,
              status,
              itemCount: sourceItems.length,
              ...(error ? { error } : {}),
            }),
          );
          if (items.length === 0) {
            const output: HumanizeResearchOutput = {
              sources: sourceStatus,
              droppedForBudget: [],
              proposals: [],
              skipped: [],
              injectionNotices: [],
              processed: advanceProcessed({ previous, included: [] }),
            };
            const result = {
              output,
              modelUsed: 'none',
              skippedForNoSources: true,
            };
            return { result, output, modelUsed: 'none' };
          }
          const quickRules = await this.readQuickRules();
          const contractPreamble =
            buildContractPreamble(AgentType.HUMANIZE_RESEARCH) ?? '';
          const selection = selectResearchInput({
            items,
            quickRules,
            systemPrompt:
              HUMANIZE_RESEARCH_SYSTEM_PROMPT + contractPreamble + '\n\n',
          });
          if (selection.included.length === 0) {
            const output: HumanizeResearchOutput = {
              sources: sourceStatus,
              droppedForBudget: selection.droppedForBudget,
              proposals: [],
              skipped: [],
              injectionNotices: [],
              processed: advanceProcessed({ previous, included: [] }),
            };
            const result = {
              output,
              modelUsed: 'none',
              skippedForNoSources: true,
            };
            return { result, output, modelUsed: 'none' };
          }
          const includedIds = new Set(
            selection.included.map((item) => item.id),
          );
          const completion = await this.modelRouter.route({
            agentType: AgentType.HUMANIZE_RESEARCH,
            request: {
              systemPrompt: HUMANIZE_RESEARCH_SYSTEM_PROMPT,
              prompt: selection.prompt,
              outputSchema: HUMANIZE_RESEARCH_OUTPUT_SCHEMA,
            },
          });
          await context.recordModelResponse(completion.text);
          const parsed = parseResearchOutput(completion.text);
          const constrained = constrainResearchProposals({
            proposals: parsed.proposals,
            includedIds,
          });
          const processed = advanceProcessed({
            previous,
            included: selection.included,
          });
          const output: HumanizeResearchOutput = {
            sources: sourceStatus,
            droppedForBudget: selection.droppedForBudget,
            ...constrained,
            injectionNotices: parsed.injectionNotices,
            processed,
          };
          const result = {
            output,
            modelUsed: completion.modelUsed,
            skippedForNoSources: false,
          };
          return { result, output, modelUsed: completion.modelUsed };
        },
      });
    return outcome.result;
  }

  private async collectSafely(
    source: HumanizeResearchSource,
    collect: () => Promise<CollectionResult>,
  ): Promise<CollectionResult> {
    try {
      return await collect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        source,
        status: CollectionStatus.FAILED,
        items: [],
        error: message,
      };
    }
  }

  private async readQuickRules(): Promise<string> {
    const configured = this.configService.get<string>(
      'HUMANIZE_RULES_REPO_PATH',
    );
    const repositoryPath = configured || DEFAULT_HUMANIZE_RULES_REPO_PATH;
    const absolutePath = expandHomePath(repositoryPath);
    return await readFile(
      join(absolutePath, 'references/quick-rules.md'),
      'utf8',
    );
  }
}
