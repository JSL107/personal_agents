import { Injectable, Logger } from '@nestjs/common';

import {
  CollectInsightsSummary,
  CollectInsightsUsecase,
} from '../../../instagram/application/collect-insights.usecase';
import {
  AutopilotTask,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 스토리는 시간당 수집 기회가 4번뿐이다. 3번 연속 실패하면 마지막 한 번이 남았을 때 알린다.
// 한두 회차 실패는 Meta 의 일시 차단(2026-11-06 09:00 실측 2분)이라 다음 회차가 채운다.
const ALERT_AFTER_CONSECUTIVE_FAILURES = 3;

// 게시된 릴스·스토리의 인사이트를 시점별로 찍는다. 평소에는 사람에게 보내지 않는다(주간 리포트가 보여 준다).
// 연속 실패만 Slack 으로 알린다. 하루 1회 발송 가드가 그날 두 번째 알림부터 막는다.
// 던지지 않는다. 산출물 없는 슬롯이 실패하면 60초 뒤 재시도로 같은 수집이 겹친다.
@Injectable()
export class ReelsInsightsCollectAutopilotTask implements AutopilotTask {
  readonly id = 'reels-insights-collect';
  private readonly logger = new Logger(ReelsInsightsCollectAutopilotTask.name);
  // 메모리에만 센다. 재시작하면 처음부터 센다 — 알림이 한 번 늦어질 뿐 수집은 그대로다.
  private consecutiveFailures = 0;

  constructor(private readonly collectInsights: CollectInsightsUsecase) {}

  async run(): Promise<AutopilotTaskResult> {
    const summary = await this.collect();
    const failedNow = this.countFailure(summary);
    // 이번 회차가 실패했을 때만 알린다. 대상이 만료돼 시도조차 없는 회차가 지난 실패로 매일 알리지 않게.
    if (
      !failedNow ||
      this.consecutiveFailures < ALERT_AFTER_CONSECUTIVE_FAILURES
    ) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: `⚠️ 릴스 인사이트 수집이 ${this.consecutiveFailures}회 연속 실패했습니다. 스토리 지표는 게시 24시간 뒤 사라집니다. 이대리 로그에서 「인사이트 수집 실패」를 확인해 주세요.`,
    };
  }

  // null 은 수집 자체가 던진 회차다.
  private async collect(): Promise<CollectInsightsSummary | null> {
    try {
      const summary = await this.collectInsights.execute();
      if (summary.inserted + summary.failed + summary.featuresFilled > 0) {
        this.logger.log(
          `인사이트 수집: 저장 ${summary.inserted} · 중복 ${summary.skipped} · 실패 ${summary.failed} · 특성 ${summary.featuresFilled}`,
        );
      }
      return summary;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`인사이트 수집 실패: ${reason}`);
      return null;
    }
  }

  // 이번 회차가 실패였는지 돌려준다. 찍을 창이 없던 회차는 아무것도 알려 주지 않으므로 세지도 끊지도 않는다.
  private countFailure(summary: CollectInsightsSummary | null): boolean {
    if (!summary || summary.failed > 0) {
      this.consecutiveFailures += 1;
      return true;
    }
    if (summary.inserted + summary.skipped > 0) {
      this.consecutiveFailures = 0;
    }
    return false;
  }
}
