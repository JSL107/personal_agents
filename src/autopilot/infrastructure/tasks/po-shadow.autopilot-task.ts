import { Injectable } from '@nestjs/common';

import { GeneratePoShadowUsecase } from '../../../agent/po-shadow/application/generate-po-shadow.usecase';
import { PoShadowException } from '../../../agent/po-shadow/domain/po-shadow.exception';
import { PoShadowReport } from '../../../agent/po-shadow/domain/po-shadow.type';
import { PoShadowErrorCode } from '../../../agent/po-shadow/domain/po-shadow-error-code.enum';
import { AgentRunOutcome } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizePoShadowReport } from '../../../humanize/application/humanize-report.adapter';
import { formatPoShadowReport } from '../../../slack/format/po-shadow.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class PoShadowAutopilotTask implements AutopilotTask {
  readonly id = 'po-shadow';

  constructor(
    private readonly generatePoShadowUsecase: GeneratePoShadowUsecase,
    private readonly humanizeService: HumanizeService,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    let outcome: AgentRunOutcome<PoShadowReport>;
    try {
      outcome = await this.generatePoShadowUsecase.execute({
        slackUserId: ownerSlackUserId,
        extraContext: '',
        triggerType: TriggerType.AUTOPILOT_PO_SHADOW_CRON,
        enforcePlanFreshness: true,
      });
    } catch (error) {
      // 계획이 없어 검토를 못 한 회차는 `skip: true` 로 끊으면 Slack·원장 어디에도 남지 않는다.
      // 이 자리는 연쇄의 중간 고리다 — 아침 PM 이 실패해 계획이 없는 날, 정오 검토와 저녁 회고가
      // 차례로 조용히 사라진다(2026-08-07·08 실측: PM 실패 → 두 회차 모두 원장 행 0개).
      // 레포의 조용한 계기판 패턴(#269 knowledge-lint / docs-sync-audit)을 따라 한 줄을 남겨,
      // "검토할 계획이 없었다" 와 "검토가 죽었다" 를 다이제스트에서 구분한다.
      if (error instanceof PoShadowException) {
        if (error.poShadowErrorCode === PoShadowErrorCode.NO_RECENT_PLAN) {
          return {
            skip: false,
            summaryText: `⏸️ *PO 대행* — ${firedAtKst} · 건너뜀 (최근 계획 없음 — 아침 계획이 만들어지지 않으면 이 검토도 함께 멈춥니다)`,
          };
        }
        if (error.poShadowErrorCode === PoShadowErrorCode.STALE_PLAN) {
          return {
            skip: false,
            summaryText: `⏸️ *PO 대행* — ${firedAtKst} · 건너뜀 (계획이 오래돼 검토 대상 아님)`,
          };
        }
      }
      throw error;
    }

    if (outcome.result.quiet) {
      return {
        skip: false,
        summaryText: formatPoShadowReport(outcome.result),
      };
    }

    const humanized = await humanizePoShadowReport(
      outcome.result,
      this.humanizeService,
    );
    return {
      skip: false,
      summaryText: formatPoShadowReport(humanized),
    };
  }
}
