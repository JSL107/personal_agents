import { Inject, Injectable, Optional } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { CodexQuotaExceededException } from '../../../model-router/infrastructure/codex-cli.provider';
import { buildQualityProfiles } from '../../../ops-supervisor/domain/ops-quality.aggregator';
import {
  detectQualityAnomalies,
  QualityAnomaly,
} from '../../../ops-supervisor/domain/ops-quality.anomaly';
import {
  OPS_SUPERVISOR_ADVISOR_PORT,
  OpsSupervisorAdvisorPort,
} from '../../../ops-supervisor/domain/port/ops-supervisor-advisor.port';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../../../preview-gate/domain/port/preview-action.repository.port';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { formatOpsSupervisor } from '../../../slack/format/ops-supervisor.formatter';
import { formatStudyApplicabilityStats } from '../../../slack/format/study-applicability-stats.formatter';
import {
  STUDY_BRIEF_REPOSITORY_PORT,
  StudyBriefRepositoryPort,
} from '../../../study-brief-cron/domain/port/study-brief.repository.port';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const WINDOW_DAYS = 30;

const summarizeAnomalies = (anomalies: QualityAnomaly[]): string =>
  anomalies.map((item) => `${item.key}: ${item.detail}`).join('\n');

@Injectable()
export class OpsSupervisorAutopilotTask implements AutopilotTask {
  readonly id = 'ops-supervisor';

  constructor(
    private readonly agentRunService: AgentRunService,
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly previewRepository: PreviewActionRepositoryPort,
    private readonly humanizeService: HumanizeService,
    @Inject(STUDY_BRIEF_REPOSITORY_PORT)
    private readonly studyBriefRepository: StudyBriefRepositoryPort,
    @Optional()
    @Inject(OPS_SUPERVISOR_ADVISOR_PORT)
    private readonly advisor?: OpsSupervisorAdvisorPort,
  ) {}

  async run({
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const now = new Date();
    const [base, retries, swept, previews] = await Promise.all([
      this.agentRunService.aggregateRunStats({ sinceDays: WINDOW_DAYS }),
      this.agentRunService.aggregateRetryCounts({ sinceDays: WINDOW_DAYS }),
      this.agentRunService.aggregateSweptCounts({ sinceDays: WINDOW_DAYS }),
      this.previewRepository.countOutcomesByKind({
        sinceDays: WINDOW_DAYS,
        now,
      }),
    ]);

    const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [applicabilityStats, adopted, rejected] = await Promise.all([
      this.studyBriefRepository.countApplicabilitySince(since, now),
      this.previewRepository.findRecentAppliedByKind({
        kind: PREVIEW_KIND.STUDY_APPLY_ISSUE,
        since,
        limit: 100,
      }),
      this.previewRepository.findRecentCancelledByKind({
        kind: PREVIEW_KIND.STUDY_APPLY_ISSUE,
        since,
        limit: 100,
      }),
    ]);
    const applicabilitySection = formatStudyApplicabilityStats(
      applicabilityStats,
      { adopted: adopted.length, rejected: rejected.length },
    );

    const profiles = buildQualityProfiles({ base, retries, swept, previews });
    const anomalies = detectQualityAnomalies(profiles);

    if (
      profiles.agents.length === 0 &&
      profiles.previews.length === 0 &&
      anomalies.length === 0 &&
      applicabilitySection.length === 0
    ) {
      return { skip: true };
    }

    let suggestion: string | null = null;
    if (anomalies.length > 0 && this.advisor) {
      try {
        suggestion = await this.advisor.advise({
          anomaliesSummary: summarizeAnomalies(anomalies),
        });
      } catch (error) {
        if (error instanceof CodexQuotaExceededException) {
          suggestion = null;
        } else {
          throw error;
        }
      }
    }

    // 조치 제안만 LLM 서술이다(나머지는 집계 수치). 제안이 없는 회차는 호출하지 않는다.
    const humanizedSuggestion = suggestion
      ? ((await this.humanizeService.humanize({ suggestion })).suggestion ??
        suggestion)
      : suggestion;

    return {
      skip: false,
      summaryText: [
        formatOpsSupervisor(
          profiles,
          anomalies,
          humanizedSuggestion,
          firedAtKst,
        ),
        applicabilitySection,
      ]
        .filter((part) => part.length > 0)
        .join('\n\n'),
    };
  }
}
