import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { buildContractPreamble } from '../../../agent-registry/agent-contract';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { resolveHumanizeRulesRepoPath } from '../../../humanize/domain/humanize-rules-repository';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  ARXIV_DEDUP_ROUNDS,
  HUMANIZE_RESEARCH_INPUT_LIMIT,
  INTERNAL_LOOKBACK_DAYS,
} from '../domain/humanize-research.constant';
import {
  CollectedItem,
  CollectionResult,
  CollectionStatus,
  HumanizeResearchOutput,
  HumanizeResearchRunResult,
  HumanizeResearchSource,
  Processed,
  ResearchInputSelection,
  SourceStatus,
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

// 직전 ARXIV_DEDUP_ROUNDS 회차를 찾는 기간. 회차가 몇 주 끊겨도 처리 기록을 잃지 않게 넉넉히 둔다.
const HISTORY_LOOKBACK_DAYS = 180;

const EMPTY_PROCESSED: Processed = {
  humanizerMaxRunId: null,
  blogPostIds: [],
  upstreamHead: null,
  arxivIds: [],
};

const isStringOrNull = (value: unknown): boolean => {
  const valid = value === null || typeof value === 'string';
  return valid;
};

const isStringArray = (value: unknown): boolean => {
  const valid =
    Array.isArray(value) && value.every((id) => typeof id === 'string');
  return valid;
};

// 원장 output 은 예전 형태가 섞일 수 있어 그대로 믿지 않는다. 형태가 다르면 첫 회차로 본다.
const readProcessed = (output: unknown): Processed | null => {
  const processed = (output as { processed?: unknown } | null)?.processed;
  if (typeof processed !== 'object' || processed === null) {
    return null;
  }
  const candidate = processed as Record<keyof Processed, unknown>;
  const checks = [
    isStringOrNull(candidate.humanizerMaxRunId),
    isStringOrNull(candidate.upstreamHead),
    isStringArray(candidate.blogPostIds),
    isStringArray(candidate.arxivIds),
  ];
  const valid = checks.every(Boolean);
  if (!valid) {
    return null;
  }
  return candidate as Processed;
};

const toSourceStatus = ({
  source,
  status,
  items,
  error,
}: CollectionResult): SourceStatus => ({
  source,
  status,
  itemCount: items.length,
  ...(error ? { error } : {}),
});

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
        inputSnapshot: {
          lookbackDays: INTERNAL_LOOKBACK_DAYS,
          inputLimit: HUMANIZE_RESEARCH_INPUT_LIMIT,
        },
        run: async (context) => {
          const { previous, recentArxivIds } = await this.loadHistory();
          const sources = await this.collectAll({ previous, recentArxivIds });
          const sourceStatus = sources.map(toSourceStatus);
          const items = sources.flatMap((source) => source.items);
          if (items.length === 0) {
            const result = this.emptyResult({ sourceStatus, previous });
            return { result, output: result.output, modelUsed: 'none' };
          }
          const selection = await this.selectInput(items);
          if (selection.included.length === 0) {
            const result = this.emptyResult({
              sourceStatus,
              previous,
              droppedForBudget: selection.droppedForBudget,
            });
            return { result, output: result.output, modelUsed: 'none' };
          }
          const completion = await this.modelRouter.route({
            agentType: AgentType.HUMANIZE_RESEARCH,
            request: {
              systemPrompt: HUMANIZE_RESEARCH_SYSTEM_PROMPT,
              prompt: selection.prompt,
              outputSchema: HUMANIZE_RESEARCH_OUTPUT_SCHEMA,
            },
          });
          await context.recordModelResponse(completion.text);
          const output = this.buildOutput({
            completionText: completion.text,
            selection,
            sourceStatus,
            previous,
          });
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

  private async loadHistory(): Promise<{
    previous: Processed;
    recentArxivIds: string[];
  }> {
    const history = await this.agentRunService.findRecentSucceededRuns({
      agentType: AgentType.HUMANIZE_RESEARCH,
      sinceDays: HISTORY_LOOKBACK_DAYS,
      limit: ARXIV_DEDUP_ROUNDS,
    });
    const previous = readProcessed(history[0]?.output) ?? EMPTY_PROCESSED;
    const arxivIds = history.flatMap(
      (run) => readProcessed(run.output)?.arxivIds ?? [],
    );
    return { previous, recentArxivIds: [...new Set(arxivIds)] };
  }

  private async collectAll({
    previous,
    recentArxivIds,
  }: {
    previous: Processed;
    recentArxivIds: string[];
  }): Promise<CollectionResult[]> {
    return await Promise.all([
      this.collectSafely({
        source: HumanizeResearchSource.HUMANIZER,
        collect: () => this.humanizer.collect(previous),
      }),
      this.collectSafely({
        source: HumanizeResearchSource.BLOG,
        collect: () => this.blog.collect(previous),
      }),
      this.collectSafely({
        source: HumanizeResearchSource.UPSTREAM,
        collect: () => this.upstream.collect(previous),
      }),
      this.collectSafely({
        source: HumanizeResearchSource.ARXIV,
        collect: () =>
          this.arxiv.collect({ ...previous, arxivIds: recentArxivIds }),
      }),
      this.collectSafely({
        source: HumanizeResearchSource.SAMPLE,
        collect: () => this.samples.collect(),
      }),
    ]);
  }

  // 예산 계산에는 라우터가 붙일 계약 머리말까지 넣는다 — 빼면 실제 입력이 예산을 넘는다.
  private async selectInput(
    items: CollectedItem[],
  ): Promise<ResearchInputSelection> {
    const preamble = buildContractPreamble(AgentType.HUMANIZE_RESEARCH) ?? '';
    return selectResearchInput({
      items,
      quickRules: await this.readQuickRules(),
      systemPrompt: `${HUMANIZE_RESEARCH_SYSTEM_PROMPT}${preamble}\n\n`,
    });
  }

  private buildOutput({
    completionText,
    selection,
    sourceStatus,
    previous,
  }: {
    completionText: string;
    selection: ResearchInputSelection;
    sourceStatus: SourceStatus[];
    previous: Processed;
  }): HumanizeResearchOutput {
    const parsed = parseResearchOutput(completionText);
    const includedIds = new Set(selection.included.map((item) => item.id));
    const constrained = constrainResearchProposals({
      proposals: parsed.proposals,
      includedIds,
    });
    const processed = advanceProcessed({
      previous,
      included: selection.included,
    });
    return {
      sources: sourceStatus,
      droppedForBudget: selection.droppedForBudget,
      ...constrained,
      injectionNotices: parsed.injectionNotices,
      processed,
    };
  }

  private emptyResult({
    sourceStatus,
    previous,
    droppedForBudget = [],
  }: {
    sourceStatus: SourceStatus[];
    previous: Processed;
    droppedForBudget?: string[];
  }): HumanizeResearchRunResult {
    const output: HumanizeResearchOutput = {
      sources: sourceStatus,
      droppedForBudget,
      proposals: [],
      skipped: [],
      injectionNotices: [],
      processed: advanceProcessed({ previous, included: [] }),
    };
    return { output, modelUsed: 'none', skippedForNoSources: true };
  }

  private async collectSafely({
    source,
    collect,
  }: {
    source: HumanizeResearchSource;
    collect: () => Promise<CollectionResult>;
  }): Promise<CollectionResult> {
    try {
      return await collect();
    } catch (error: unknown) {
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
    const repositoryPath = resolveHumanizeRulesRepoPath(
      this.configService.get<string>('HUMANIZE_RULES_REPO_PATH'),
    );
    return await readFile(
      join(repositoryPath, 'references/quick-rules.md'),
      'utf8',
    );
  }
}
