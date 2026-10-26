import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../../agent-run/application/agent-run.service';
import { AgentType } from '../../../../model-router/domain/model-router.type';
import { INTERNAL_LOOKBACK_DAYS } from '../../domain/humanize-research.constant';
import {
  CollectionResult,
  CollectionStatus,
  HumanizeResearchSource,
  Processed,
} from '../../domain/humanize-research.type';

// 실측 주당 54~74회(2026-09-21~10-19). 4주치를 넉넉히 덮는다.
const RUN_LIMIT = 500;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  const isObject = typeof value === 'object' && value !== null;
  const isPlainObject = isObject && !Array.isArray(value);
  return isPlainObject;
};

const isFiniteNumber = (value: unknown): value is number =>
  Number.isFinite(value);

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const numbersOf = (value: unknown): [string, number][] =>
  isRecord(value)
    ? Object.entries(value).filter((entry): entry is [string, number] =>
        isFiniteNumber(entry[1]),
      )
    : [];

const countBy = (keys: string[]): Map<string, number> =>
  keys.reduce(
    (tally, key) => tally.set(key, (tally.get(key) ?? 0) + 1),
    new Map<string, number>(),
  );

const sumBy = (entries: [string, number][]): Map<string, number> =>
  entries.reduce(
    (tally, [key, value]) => tally.set(key, (tally.get(key) ?? 0) + value),
    new Map<string, number>(),
  );

// 문체 갭은 "종결체교대 18%(≤5%)" 꼴이라 앞의 축 이름만 센다.
const styleAxesOf = (output: Record<string, unknown>): string[] =>
  stringsOf(output.styleGaps)
    .map((gap) => gap.trim().split(/\s+/u)[0])
    .filter((axis) => axis.length > 0);

// 보존 위반은 { lost: { code: 1, … }, injected: { … } } 꼴이다.
const preservationCountsOf = (output: Record<string, unknown>): number[] => {
  const directions = isRecord(output.preservationViolations)
    ? Object.values(output.preservationViolations)
    : [];
  return directions.flatMap((direction) =>
    numbersOf(direction).map(([, count]) => count),
  );
};

// 원장의 번역투는 개수 축과 비율 축(inanimateSubjectPercent)이 섞여 있다.
// 비율을 회차마다 더하면 수백 % 가 되므로 비율 축은 평균으로 낸다.
const summarizeTranslationese = ({
  totals,
  runCount,
}: {
  totals: Map<string, number>;
  runCount: number;
}): Map<string, number> =>
  new Map(
    [...totals.entries()].map(([axis, total]) => {
      const isPercent = axis.endsWith('Percent');
      const label = isPercent ? `${axis}(평균)` : axis;
      const value = isPercent ? Math.round(total / runCount) : total;
      return [label, value];
    }),
  );

const formatTally = (tally: Map<string, number>): string => {
  const ranked = [...tally.entries()].sort((left, right) => right[1] - left[1]);
  const lines = ranked.map(([key, count]) => `${key}: ${count}`);
  const text = lines.join(', ');
  return text || '없음';
};

@Injectable()
export class HumanizerSignalsCollector {
  constructor(private readonly agentRunService: AgentRunService) {}

  async collect(processed: Processed): Promise<CollectionResult> {
    try {
      const runs = await this.agentRunService.findRecentSucceededRuns({
        agentType: AgentType.HUMANIZER,
        sinceDays: INTERNAL_LOOKBACK_DAYS,
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
      const outputs = fresh
        .map((run) => run.output)
        .filter((output): output is Record<string, unknown> =>
          isRecord(output),
        );
      const translationese = summarizeTranslationese({
        totals: sumBy(
          outputs.flatMap((output) => numbersOf(output.translationese)),
        ),
        runCount: fresh.length,
      });
      const preservationViolationCount = outputs
        .flatMap(preservationCountsOf)
        .reduce((sum, count) => sum + count, 0);
      const rollbacks = countBy(
        outputs.flatMap((output) => stringsOf(output.rolledBackKeys)),
      );
      const overRewrites = countBy(
        outputs.flatMap((output) => stringsOf(output.overRewrittenKeys)),
      );
      const styleGaps = countBy(outputs.flatMap(styleAxesOf));
      const ids = fresh.map((run) => run.id);
      const text = [
        `윤문 회차 ${fresh.length}건`,
        `롤백 키 빈도: ${formatTally(rollbacks)}`,
        `과윤문 키 빈도: ${formatTally(overRewrites)}`,
        `번역투 축별 합계: ${formatTally(translationese)}`,
        `보존 위반 건수: ${preservationViolationCount}`,
        `문체 갭 빈도: ${formatTally(styleGaps)}`,
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
