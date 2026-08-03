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
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const now = new Date();
    const [
      succeeded,
      activeRuns,
      allOpenPreviews,
      failedRuns,
      recentlyFinished,
    ] = await Promise.all([
      this.agentRunService.aggregateSucceededCounts({
        sinceDays: WINDOW_DAYS,
      }),
      this.agentRunService.findActiveRuns(),
      this.findAllOpenPreviews.execute({ now }),
      this.agentRunService.findFailedRunsSince({
        withinMinutes: WINDOW_MINUTES,
      }),
      this.agentRunService.findRecentlyFinishedRuns({
        withinMinutes: WINDOW_MINUTES,
      }),
    ]);

    // 승인 카드는 owner 것만 남긴다. FindAllOpenPreviewsUsecase 는 콘솔 관제용이라
    // 사용자 구분 없이 전부 돌려주는데, 이 보고는 owner 에게 가고 owner 만 승인할 수 있다
    // (승인 경로가 slackUserId 를 검사한다). 남의 카드를 실으면 제목이 노출되는 데다
    // 대표가 처리할 수도 없는 항목이 결정거리로 올라간다.
    const openPreviews = allOpenPreviews.filter(
      (preview) => preview.slackUserId === ownerSlackUserId,
    );

    const digest = buildSecretariatDigest({
      succeeded,
      activeRuns,
      openPreviews,
      failedRuns,
      // 최신 종료가 실패인 것만 "아직 안 풀린 것" 이다. 조회가 성공/실패를 함께 주므로
      // 여기서 걸러낸다(성공으로 뒤집힌 에이전트는 목록에서 빠진다).
      unresolvedAgentTypes: recentlyFinished
        .filter((run) => run.status === 'FAILED')
        .map((run) => run.agentType),
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
