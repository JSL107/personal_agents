import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { FindAllOpenPreviewsUsecase } from '../../../preview-gate/application/find-all-open-previews.usecase';
import { formatSecretariat } from '../../../slack/format/secretariat.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';
import {
  buildSecretariatDigest,
  isSecretariatDigestEmpty,
} from '../../domain/secretariat.digest';

// 하루 한 장 결산의 관측 창. 아침 발화라 "어제 하루" 로 자르려면 KST 자정 경계 쿼리가
// 따로 필요한데, 24시간 창으로도 목적은 같고 표기만 정직하면 된다("지난 24시간").
const WINDOW_DAYS = 1;
const WINDOW_MINUTES = 24 * 60;

// 비서실 — 전 부서 결과를 모아 하루 한 번 올린다. LLM 을 호출하지 않고, 아무것도 막지 않는다.
// 발송은 오케스트레이터가 담당 — 여기선 텍스트만 만든다.
@Injectable()
export class SecretariatAutopilotTask implements AutopilotTask {
  readonly id = 'secretariat';

  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly findAllOpenPreviews: FindAllOpenPreviewsUsecase,
  ) {}

  async run({
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const now = new Date();
    const [stats, activeRuns, openPreviews, failedRuns] = await Promise.all([
      this.agentRunService.aggregateRunStats({ sinceDays: WINDOW_DAYS }),
      this.agentRunService.findActiveRuns(),
      this.findAllOpenPreviews.execute({ now }),
      this.agentRunService.findFailedRunsSince({
        withinMinutes: WINDOW_MINUTES,
      }),
    ]);

    const digest = buildSecretariatDigest({
      stats,
      activeRuns,
      openPreviews,
      failedRuns,
      now,
    });
    if (isSecretariatDigestEmpty(digest)) {
      return { skip: true };
    }

    return {
      skip: false,
      summaryText: formatSecretariat(digest, firedAtKst, now),
    };
  }
}
