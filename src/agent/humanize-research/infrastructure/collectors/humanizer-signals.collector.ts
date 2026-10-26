import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../../agent-run/application/agent-run.service';
import { AgentType } from '../../../../model-router/domain/model-router.type';
import {
  CollectionResult,
  CollectionStatus,
  HumanizeResearchSource,
  Processed,
} from '../../domain/humanize-research.type';

const LOOKBACK_DAYS = 28;
const RUN_LIMIT = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const tallyStrings = (value: unknown, tally: Map<string, number>): void => {
  if (!Array.isArray(value)) {
    return;
  }
  for (const key of value) {
    if (typeof key === 'string') {
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }
};

const tallyStyleGaps = (value: unknown, tally: Map<string, number>): void => {
  if (!Array.isArray(value)) {
    return;
  }
  for (const gap of value) {
    if (typeof gap === 'string' && gap.trim().length > 0) {
      const axis = gap.trim().split(/\s+/u)[0];
      tally.set(axis, (tally.get(axis) ?? 0) + 1);
    }
  }
};

const formatTally = (tally: Map<string, number>): string =>
  [...tally.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => `${key}: ${count}`)
    .join(', ') || '없음';

@Injectable()
export class HumanizerSignalsCollector {
  constructor(private readonly agentRunService: AgentRunService) {}

  async collect(processed: Processed): Promise<CollectionResult> {
    try {
      const runs = await this.agentRunService.findRecentSucceededRuns({
        agentType: AgentType.HUMANIZER,
        sinceDays: LOOKBACK_DAYS,
        limit: RUN_LIMIT,
      });
      const maxId = Number(processed.humanizerMaxRunId ?? 0);
      const fresh = runs.filter((run) => run.id > maxId);
      if (fresh.length === 0) {
        return {
          source: HumanizeResearchSource.HUMANIZER,
          status: CollectionStatus.EMPTY,
          items: [],
        };
      }

      const rollback = new Map<string, number>();
      const overRewrite = new Map<string, number>();
      const styleGap = new Map<string, number>();
      const translationese = new Map<string, number>();
      let preservationViolationCount = 0;
      for (const run of fresh) {
        if (!isRecord(run.output)) {
          continue;
        }
        tallyStrings(run.output.rolledBackKeys, rollback);
        tallyStrings(run.output.overRewrittenKeys, overRewrite);
        tallyStyleGaps(run.output.styleGaps, styleGap);
        if (isRecord(run.output.translationese)) {
          for (const [axis, count] of Object.entries(
            run.output.translationese,
          )) {
            if (typeof count === 'number' && Number.isFinite(count)) {
              translationese.set(axis, (translationese.get(axis) ?? 0) + count);
            }
          }
        }
        if (isRecord(run.output.preservationViolations)) {
          for (const direction of Object.values(
            run.output.preservationViolations,
          )) {
            if (!isRecord(direction)) {
              continue;
            }
            for (const count of Object.values(direction)) {
              if (typeof count === 'number' && Number.isFinite(count)) {
                preservationViolationCount += count;
              }
            }
          }
        }
      }
      // 원장의 번역투는 개수 축과 비율 축(inanimateSubjectPercent)이 섞여 있다.
      // 비율을 회차마다 더하면 수백 % 가 되므로 비율 축은 평균으로 낸다.
      const translationeseSummary = new Map(
        [...translationese.entries()].map(([axis, total]) => {
          const isPercent = axis.endsWith('Percent');
          const value = isPercent ? Math.round(total / fresh.length) : total;
          return [isPercent ? `${axis}(평균)` : axis, value];
        }),
      );
      const ids = fresh.map((run) => run.id);
      const text = [
        `윤문 회차 ${fresh.length}건`,
        `롤백 키 빈도: ${formatTally(rollback)}`,
        `과윤문 키 빈도: ${formatTally(overRewrite)}`,
        `번역투 축별 합계: ${formatTally(translationeseSummary)}`,
        `보존 위반 건수: ${preservationViolationCount}`,
        `문체 갭 빈도: ${formatTally(styleGap)}`,
      ].join('\n');
      return {
        source: HumanizeResearchSource.HUMANIZER,
        status: CollectionStatus.OK,
        items: [
          {
            id: `humanizer:${Math.min(...ids)}-${Math.max(...ids)}`,
            source: HumanizeResearchSource.HUMANIZER,
            text,
          },
        ],
      };
    } catch (error: unknown) {
      return {
        source: HumanizeResearchSource.HUMANIZER,
        status: CollectionStatus.FAILED,
        items: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
