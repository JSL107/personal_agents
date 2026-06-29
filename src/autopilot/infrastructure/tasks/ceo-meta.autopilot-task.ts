import { Injectable } from '@nestjs/common';

import { GenerateCeoMetaUsecase } from '../../../agent/ceo/application/generate-ceo-meta.usecase';
import { CeoException } from '../../../agent/ceo/domain/ceo.exception';
import { CeoErrorCode } from '../../../agent/ceo/domain/ceo-error-code.enum';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { formatCeoMetaOutput } from '../../../slack/format/ceo-meta.formatter';
import { formatModelFooter } from '../../../slack/format/model-footer.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// CEO Meta 이관 — 매주 일요일 18:00 KST PO_EVAL run 누적(WEEK)을 메타 회고로 합성.
// 기존 src/ceo-meta-cron/infrastructure/ceo-meta-cron.consumer.ts 의 핵심 로직을 task 로 옮김.
// NO_PO_EVAL_RUN 이면 graceful 안내문(skip=false). 발송은 오케스트레이터(T0) 가 담당.
@Injectable()
export class CeoMetaAutopilotTask implements AutopilotTask {
  readonly id = 'ceo-meta';

  constructor(
    private readonly generateCeoMetaUsecase: GenerateCeoMetaUsecase,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    try {
      const outcome = await this.generateCeoMetaUsecase.execute({
        slackUserId: ownerSlackUserId,
        range: 'WEEK',
        triggerType: TriggerType.WEEKLY_CEO_META_CRON,
      });
      const formatted = formatCeoMetaOutput(outcome.result);
      const text =
        `🧭 *CEO Meta — ${firedAtKst} (최근 7일 자동 회고)*\n\n` +
        formatted.summary +
        '\n\n' +
        formatted.detail +
        formatModelFooter(outcome);
      return { skip: false, summaryText: text };
    } catch (error) {
      if (
        error instanceof CeoException &&
        error.ceoErrorCode === CeoErrorCode.NO_PO_EVAL_RUN
      ) {
        return {
          skip: false,
          summaryText: `🌙 *CEO Meta — ${firedAtKst} skip*\n_최근 7일 안 PO_EVAL run 부재로 메타 회고 대상 없음. 다음 주기에 다시 시도합니다._`,
        };
      }
      throw error;
    }
  }
}
