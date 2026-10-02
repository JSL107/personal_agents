import { Injectable } from '@nestjs/common';

import { GeneratePoEvaluationUsecase } from '../../../agent/po-eval/application/generate-po-evaluation.usecase';
import { PoEvalException } from '../../../agent/po-eval/domain/po-eval.exception';
import { PoEvalErrorCode } from '../../../agent/po-eval/domain/po-eval-error-code.enum';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { SucceededAgentRunSnapshot } from '../../../agent-run/domain/port/agent-run.repository.port';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeEvaluationOutput } from '../../../humanize/application/humanize-report.adapter';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { formatModelFooter } from '../../../slack/format/model-footer.formatter';
import { formatEvaluationOutput } from '../../../slack/format/po-evaluation.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 업무 회고 run 이 "이번 저녁 다이제스트에서 방금 나간 것" 으로 볼 수 있는 시간 폭. evening 그룹은
// work-reviewer → daily-eval 을 연달아 돌리므로 그 사이는 수 분이다.
// ponytail: 시각으로 같은 회차를 추정한다 — 그룹이 결과를 task 끼리 넘기게 되면 그 값으로 바꾼다.
const SAME_DIGEST_WINDOW_MS = 30 * 60 * 1000;

// PO 평가가 합성에 쓴 업무 회고 run 이 이번 다이제스트 스레드에 「정량 근거」를 이미 실었는가.
// 셋 다 맞아야 한다: 같은 run 이다(오늘 앞서 돈 수동 /worklog 가 아니다), 방금 끝났다(오늘 저녁
// work-reviewer task 가 실패해 이전 run 을 집은 회차가 아니다), 정량 근거가 비어 있지 않다(비면
// 업무 회고 스레드에 그 칸 자체가 없다). 하나라도 어긋나면 careerLog 정량 성과를 그대로 보인다 —
// 숫자가 두 번 나오는 쪽이 한 번도 안 나오는 쪽보다 싸다.
export const isQuantitativeShownInDigest = (
  workReviewerRunId: number | undefined,
  latestWorklogRun: SucceededAgentRunSnapshot | undefined,
  now: Date,
): boolean => {
  if (workReviewerRunId === undefined || latestWorklogRun === undefined) {
    return false;
  }
  if (latestWorklogRun.id !== workReviewerRunId) {
    return false;
  }
  if (
    now.getTime() - latestWorklogRun.endedAt.getTime() >
    SAME_DIGEST_WINDOW_MS
  ) {
    return false;
  }
  const quantitative = (
    latestWorklogRun.output as { impact?: { quantitative?: unknown } } | null
  )?.impact?.quantitative;
  return Array.isArray(quantitative) && quantitative.length > 0;
};

// Daily Eval 이관 — 매일 19:00 KST PO_EVAL(range=TODAY) 자동 회고.
// 기존 src/daily-eval/infrastructure/daily-eval.consumer.ts 의 핵심 로직을 task 로 옮김.
// 발송은 오케스트레이터(T0)가 담당 — 여기선 텍스트만 만든다.
@Injectable()
export class PoEvalAutopilotTask implements AutopilotTask {
  readonly id = 'daily-eval';

  constructor(
    private readonly generatePoEvaluation: GeneratePoEvaluationUsecase,
    private readonly humanizeService: HumanizeService,
    private readonly agentRunService: AgentRunService,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    try {
      const outcome = await this.generatePoEvaluation.execute({
        slackUserId: ownerSlackUserId,
        range: 'TODAY',
        triggerType: TriggerType.DAILY_EVAL_CRON,
      });
      const humanized = await humanizeEvaluationOutput(
        outcome.result,
        this.humanizeService,
      );
      const workReviewerRunId =
        outcome.result.sourceAgentRuns.workReviewerRunId;
      const [latestWorklogRun] =
        workReviewerRunId === undefined
          ? []
          : await this.agentRunService.findRecentSucceededRuns({
              agentType: AgentType.WORK_REVIEWER,
              slackUserId: ownerSlackUserId,
              sinceDays: 1,
              limit: 1,
            });
      const formatted = formatEvaluationOutput(
        humanized,
        workReviewerRunId !== undefined &&
          isQuantitativeShownInDigest(
            workReviewerRunId,
            latestWorklogRun,
            new Date(),
          )
          ? { quantitativeShownElsewhere: { workReviewerRunId } }
          : {},
      );
      // 저녁 메인에는 한 줄만 둔다. 평가 요약·Wins·Blockers 는 같은 메시지의 업무 회고 「오늘 한 일」·
      // 저녁 회고 KPT 와 같은 사실을 되풀이해, 메인 중복의 원천이었다(설계 2026-10-02 evening-digest-dedup).
      // 내용은 버리지 않고 스레드 맨 앞으로 옮긴다. 수동 /po-eval 은 이 task 를 거치지 않아 종전대로다.
      const { wins, blockers } = humanized.qualitative;
      const summaryText = `🌅 *Daily Eval — ${firedAtKst} (19:00 KST 자동 회고)* · Wins ${wins.length} · Blockers ${blockers.length} — 내용은 스레드`;
      const detailText = `${formatted.summary}\n\n${formatted.detail}${formatModelFooter(outcome)}`;
      // 메인에는 건수뿐이라 상세가 유일한 사본이다 — 스레드 실패 시 채널로 대피시킨다.
      return { skip: false, summaryText, detailText, detailIsOnlyCopy: true };
    } catch (error) {
      if (
        error instanceof PoEvalException &&
        error.poEvalErrorCode === PoEvalErrorCode.NO_SUB_AGENT_RUNS
      ) {
        return {
          skip: false,
          summaryText: `🌙 *Daily Eval — ${firedAtKst} skip*\n_오늘 sub-agent (Work Reviewer / PO Shadow / Impact Reporter) run 부재로 회고 대상 없음. 내일 19:00 KST 에 다시 시도합니다._`,
        };
      }
      throw error;
    }
  }
}
