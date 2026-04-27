import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { GenerateDailyPlanUsecase } from '../../agent/pm/application/generate-daily-plan.usecase';
import { PmAgentException } from '../../agent/pm/domain/pm-agent.exception';
import { PmAgentErrorCode } from '../../agent/pm/domain/pm-agent-error-code.enum';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { formatDailyPlan } from '../../slack/format/daily-plan.formatter';
import { formatModelFooter } from '../../slack/format/model-footer.formatter';
import {
  MORNING_BRIEFING_QUEUE,
  MorningBriefingJobData,
} from '../domain/morning-briefing.type';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../domain/port/slack-notifier.port';

// PRO-1 Morning Briefing Consumer.
// 매일 cron 시각에 트리거되어 (1) PM Agent /today 와 동일한 plan 생성 후 (2) target 슬랙 채널/사용자로 발송.
// AgentRun / EvidenceRecord 흔적은 GenerateDailyPlanUsecase 가 그대로 남기므로 별도 트리거 타입 분리는 일단 보류
// (수동 /today 와 발송 결과는 동일 구조라 daily_plan 테이블 upsert 가 자연 머지).
@Processor(MORNING_BRIEFING_QUEUE)
export class MorningBriefingConsumer extends WorkerHost {
  private readonly logger = new Logger(MorningBriefingConsumer.name);

  constructor(
    private readonly generateDailyPlanUsecase: GenerateDailyPlanUsecase,
    // OPS-7: SlackService 직접 의존 대신 도메인 port 만 의존 — Slack 어댑터 외 다른 발송 채널로 교체 가능.
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
  ) {
    super();
  }

  async process(job: Job<MorningBriefingJobData>): Promise<void> {
    return this.consume(job);
  }

  private async consume(job: Job<MorningBriefingJobData>): Promise<void> {
    const { ownerSlackUserId, target } = job.data;
    this.logger.log(
      `Morning Briefing 시작 — owner=${ownerSlackUserId} → target=${target}`,
    );

    try {
      // tasksText 빈 문자열로 호출 — GitHub assigned / Notion task / Slack 멘션 / 직전 PM·Work Reviewer
      // 자동 컨텍스트만으로 plan 을 만든다. 컨텍스트 모두 비어있으면 EMPTY_TASKS_INPUT 예외로 빠진다.
      // OPS-8: triggerType 명시 — agent_run 테이블에서 자동 발화(MORNING_BRIEFING_CRON) 와 수동 /today 구분.
      const outcome = await this.generateDailyPlanUsecase.execute({
        tasksText: '',
        slackUserId: ownerSlackUserId,
        triggerType: TriggerType.MORNING_BRIEFING_CRON,
      });

      const text =
        formatDailyPlan(outcome.result.plan, outcome.result.sources) +
        formatModelFooter(outcome);

      await this.slackNotifier.postMessage({ target, text });
      this.logger.log(`Morning Briefing 발송 완료 — target=${target}`);
    } catch (error: unknown) {
      // EMPTY_TASKS_INPUT — 자동 컨텍스트가 모두 비어있는 정상 상황. retry 의미 없으므로 친절 메시지로 마감 (omc P2 지적).
      if (
        error instanceof PmAgentException &&
        error.pmAgentErrorCode === PmAgentErrorCode.EMPTY_TASKS_INPUT
      ) {
        await this.slackNotifier.postMessage({
          target,
          text: '오늘 자동 수집된 할 일이 없습니다 (GitHub/Notion/Slack 모두 비어있음). 필요하면 `/today <할 일>` 로 직접 입력해주세요.',
        });
        this.logger.log(
          `Morning Briefing — 빈 컨텍스트로 graceful 마감 (target=${target})`,
        );
        return;
      }
      // 그 외 transient 실패는 BullMQ retry (attempts=3 + exponential backoff) 로 위임.
      throw error;
    }
  }
}
