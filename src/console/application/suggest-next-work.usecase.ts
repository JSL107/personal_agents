import { Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import {
  formatKstDate,
  getTodayKstDate,
} from '../../common/util/kst-date.util';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConsoleAgent, ConsoleAgentState } from '../domain/console.type';
import {
  WorkSuggestion,
  WorkSuggestionResult,
} from '../domain/work-suggestion.type';
import { ConsoleReadService } from './console-read.service';

const HISTORY_DAYS = 60;
// 로컬 원장 30일 실측상 CODE_REVIEWER의 하루 최대 성공은 2026-08-11 30건,
// 2026-08-12 21건이다. 일별 쏠림 뒤에도 여러 성공일을 남기도록 300건을 조회한다.
const HISTORY_LIMIT = 300;
const MAX_SUGGESTIONS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

interface ScoredSuggestion {
  readonly suggestion: WorkSuggestion;
  readonly overdueRatio: number;
}

interface CandidateResult {
  readonly scoredSuggestion: ScoredSuggestion | null;
  readonly hasUnknownCycle: boolean;
}

@Injectable()
export class SuggestNextWorkUsecase {
  private readonly logger = new Logger(SuggestNextWorkUsecase.name);

  constructor(
    private readonly consoleRead: ConsoleReadService,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute(): Promise<WorkSuggestionResult> {
    const snapshot = await this.consoleRead.getSnapshot();
    const candidates = snapshot.agents.filter(isAvailableCandidate);
    const results = await Promise.all(
      candidates.map((candidate) => this.evaluateCandidate(candidate)),
    );
    const skippedUnknownCycle = results.filter(
      (result) => result.hasUnknownCycle,
    ).length;
    const scoredSuggestions = results
      .flatMap((result) =>
        result.scoredSuggestion === null ? [] : [result.scoredSuggestion],
      )
      .sort((left, right) => right.overdueRatio - left.overdueRatio);
    const suggestions = scoredSuggestions
      .slice(0, MAX_SUGGESTIONS)
      .map((result) => result.suggestion);
    const alsoDueCount = scoredSuggestions.length - suggestions.length;

    if (skippedUnknownCycle > 0) {
      this.logger.log(
        `콘솔 할 일 제안에서 주기 미상 worker ${skippedUnknownCycle}개 제외`,
      );
    }

    return { suggestions, skippedUnknownCycle, alsoDueCount };
  }

  private async evaluateCandidate(
    candidate: ConsoleAgent,
  ): Promise<CandidateResult> {
    const agentType = candidate.agentType as AgentType;
    const runs = await this.agentRunService.findRecentSucceededRuns({
      agentType,
      sinceDays: HISTORY_DAYS,
      limit: HISTORY_LIMIT,
    });
    const succeededDates = [
      ...new Set(
        runs
          .map((run) => formatKstDate(run.endedAt.toISOString()))
          .filter((date): date is string => date !== null),
      ),
    ].sort((left, right) => right.localeCompare(left));
    if (runs.length === HISTORY_LIMIT && succeededDates.length < 6) {
      this.logger.warn(
        `콘솔 할 일 제안 원장 표본 부족 — ${agentType}: 성공 run ${runs.length}/${HISTORY_LIMIT}건, 서로 다른 성공일 ${succeededDates.length}개`,
      );
    }
    if (succeededDates.length < 2) {
      return { scoredSuggestion: null, hasUnknownCycle: true };
    }

    const medianIntervalDays = calculateMedianIntervalDays(succeededDates);
    const elapsedDays = differenceInCalendarDays(
      succeededDates[0],
      getTodayKstDate(),
    );
    const overdueRatio = elapsedDays / medianIntervalDays;
    if (overdueRatio < 1) {
      return { scoredSuggestion: null, hasUnknownCycle: false };
    }

    return {
      scoredSuggestion: {
        overdueRatio,
        suggestion: {
          agentType,
          displayName: candidate.displayName,
          reason: `마지막 성공 ${elapsedDays}일 전 · 평소 ${medianIntervalDays}일 주기`,
        },
      },
      hasUnknownCycle: false,
    };
  }
}

const isAvailableCandidate = (agent: ConsoleAgent): boolean =>
  agent.state !== ConsoleAgentState.IN_PROGRESS &&
  agent.state !== ConsoleAgentState.AWAITING_APPROVAL;

const calculateMedianIntervalDays = (dates: readonly string[]): number => {
  const intervals = dates
    .slice(0, -1)
    .map((date, index) => differenceInCalendarDays(dates[index + 1], date))
    .sort((left, right) => left - right);
  const middleIndex = Math.floor(intervals.length / 2);
  if (intervals.length % 2 === 1) {
    return intervals[middleIndex];
  }
  return (intervals[middleIndex - 1] + intervals[middleIndex]) / 2;
};

// YYYY-MM-DD는 UTC 자정으로 파싱되므로 서버 로컬 timezone과 무관하게 캘린더 일수를 센다.
const differenceInCalendarDays = (earlier: string, later: string): number =>
  (Date.parse(later) - Date.parse(earlier)) / DAY_MS;
