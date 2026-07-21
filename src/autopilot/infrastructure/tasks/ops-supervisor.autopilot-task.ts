import { Inject, Injectable, Optional } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
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
import { formatOpsSupervisor } from '../../../slack/format/ops-supervisor.formatter';
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

    const profiles = buildQualityProfiles({ base, retries, swept, previews });
    const anomalies = detectQualityAnomalies(profiles);

    if (
      profiles.agents.length === 0 &&
      profiles.previews.length === 0 &&
      anomalies.length === 0
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

    return {
      skip: false,
      summaryText: formatOpsSupervisor(
        profiles,
        anomalies,
        suggestion,
        firedAtKst,
      ),
    };
  }
}
