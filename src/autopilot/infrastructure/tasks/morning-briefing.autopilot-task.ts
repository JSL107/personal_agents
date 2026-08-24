import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { GenerateDailyPlanUsecase } from '../../../agent/pm/application/generate-daily-plan.usecase';
import { PmAgentException } from '../../../agent/pm/domain/pm-agent.exception';
import { PmAgentErrorCode } from '../../../agent/pm/domain/pm-agent-error-code.enum';
import { summarizePortfolioValue } from '../../../agent/stock/domain/portfolio-exposure';
import { USD_KRW_PAIR } from '../../../agent/stock/domain/stock-monitor.type';
import { formatPortfolioValue } from '../../../agent/stock/infrastructure/stock-monitor.formatter';
import { StockMonitorPrismaRepository } from '../../../agent/stock/infrastructure/stock-monitor.prisma.repository';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeDailyPlan } from '../../../humanize/application/humanize-report.adapter';
import { formatDailyPlan } from '../../../slack/format/daily-plan.formatter';
import { formatModelFooter } from '../../../slack/format/model-footer.formatter';
import { formatWaitingSection } from '../../../slack/format/waiting-section.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 환율을 저장하는 것은 저녁 감시라 아침에는 늘 어제 값이 최신이다. 연휴를 감안해도 이만큼
// 묵었으면 환산이 자산 규모를 왜곡하므로, 그때는 자산 줄 자체를 내지 않는다.
const MAXIMUM_FX_RATE_AGE_DAYS = 7;
// 잔고 동기화가 멈춘 채 며칠 지나면 수량 자체가 옛것이다. 평가액은 계산되지만 그것은
// 지금 자산이 아니다 — 환율에 상한을 둔 것과 같은 이유로 그때는 줄을 내지 않는다.
const MAXIMUM_HOLDING_AGE_DAYS = 7;

const ageInDaysOf = (date: Date): number =>
  (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);

// Morning Briefing 이관 — 매일 08:30 KST PM /today 자동 발화.
// 기존 src/morning-briefing/infrastructure/morning-briefing.consumer.ts 의 핵심 로직을 task 로 옮김.
// 발송은 오케스트레이터(T0)가 담당 — 여기선 텍스트만 만든다.
@Injectable()
export class MorningBriefingAutopilotTask implements AutopilotTask {
  readonly id = 'morning-briefing';
  private readonly logger = new Logger(MorningBriefingAutopilotTask.name);

  constructor(
    private readonly generateDailyPlan: GenerateDailyPlanUsecase,
    private readonly humanizeService: HumanizeService,
    private readonly stockRepository: StockMonitorPrismaRepository,
  ) {}

  async run({
    ownerSlackUserId,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    try {
      const outcome = await this.generateDailyPlan.execute({
        tasksText: '',
        slackUserId: ownerSlackUserId,
        triggerType: TriggerType.MORNING_BRIEFING_CRON,
      });
      const humanizedPlan = await humanizeDailyPlan(
        outcome.result.plan,
        this.humanizeService,
      );
      const formatted = formatDailyPlan(humanizedPlan);
      const summaryText =
        formatted.summary + formatWaitingSection(outcome.result.waitingItems);
      const detailText = formatted.detail + formatModelFooter(outcome);
      return {
        skip: false,
        summaryText: await this.appendPortfolioValue(summaryText),
        detailText,
      };
    } catch (error) {
      if (
        error instanceof PmAgentException &&
        error.pmAgentErrorCode === PmAgentErrorCode.EMPTY_TASKS_INPUT
      ) {
        // 할 일이 없는 날에도 자산은 말해 준다 — 이 목표가 겨냥한 것이 정확히 "아무 일
        // 없는 날" 이다.
        return {
          skip: false,
          summaryText: await this.appendPortfolioValue(
            '오늘 자동 수집된 할 일이 없습니다 (GitHub/Notion/Slack 모두 비어있음). 필요하면 `/today <할 일>` 로 직접 입력해주세요.',
          ),
        };
      }
      throw error;
    }
  }

  // 자산 한 줄은 브리핑의 곁다리다. 조회가 실패해도 브리핑 본체는 나가야 한다 —
  // 장식 쿼리 하나가 본체를 죽이는 것을 이 레포에서 이미 겪었다.
  private async appendPortfolioValue(summaryText: string): Promise<string> {
    try {
      const positions = await this.stockRepository.findPortfolioPositions();
      if (positions.length === 0) {
        return summaryText;
      }
      const holdingAgeDays = Math.min(
        ...positions.map((position) => ageInDaysOf(position.holdingDate)),
      );
      if (holdingAgeDays > MAXIMUM_HOLDING_AGE_DAYS) {
        this.logger.warn(
          `잔고가 ${Math.floor(holdingAgeDays)}일 전 값이라 자산 요약을 생략합니다.`,
        );
        return summaryText;
      }
      const rate = await this.resolveUsdKrwRate();
      const value = summarizePortfolioValue(positions, rate);
      const valueText = formatPortfolioValue(value);
      if (!valueText) {
        return summaryText;
      }
      return `${summaryText}\n\n${valueText}`;
    } catch (error) {
      this.logger.warn(`자산 요약 생략 — ${(error as Error).message}`);
      return summaryText;
    }
  }

  private async resolveUsdKrwRate(): Promise<Prisma.Decimal | null> {
    const stored = await this.stockRepository.findLatestFxRate(USD_KRW_PAIR);
    if (!stored) {
      return null;
    }
    const ageDays = ageInDaysOf(stored.rateDate);
    if (ageDays > MAXIMUM_FX_RATE_AGE_DAYS) {
      this.logger.warn(
        `환율이 ${Math.floor(ageDays)}일 전 값이라 자산 요약에 쓰지 않습니다.`,
      );
      return null;
    }
    return new Prisma.Decimal(stored.rate);
  }
}
