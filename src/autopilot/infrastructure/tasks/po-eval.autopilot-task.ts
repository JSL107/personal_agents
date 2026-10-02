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
// work-reviewer → daily-eval 을 연달아 돌리므로 그 사이는 수 분이다. 수동 /worklog 는 시간이 아니라
// 실행 경로(triggerType)로 걸러낸다 — 30분 안에 돈 수동 run 은 시간 조건을 통과하기 때문이다.
const SAME_DIGEST_WINDOW_MS = 30 * 60 * 1000;

// 숫자 토큰 — 숫자와 바로 뒤 단위를 함께 본다("28건", "8552줄"). 숫자만 보면 "1건" 같은 흔한 값이
// 엉뚱한 항목과 맞아 고유 성과가 숨는다. 쉼표 자리수와 숫자·단위 사이 공백은 떼고 비교한다.
const extractNumbers = (text: string): string[] =>
  (text.match(/\d[\d,]*(?:\.\d+)?\s*[가-힣A-Za-z%]*/g) ?? []).map((token) =>
    token.replace(/[,\s]/g, ''),
  );

// careerLog 정량 항목이 업무 회고 「정량 근거」에 이미 나간 것인가. 두 목록은 다른 모델 호출이 쓴
// 문장이라 글자로는 거의 맞지 않는다 — 대신 숫자를 본다. 항목의 숫자가 **전부** 업무 회고 쪽에
// 있을 때만 같은 성과로 친다. 숫자가 없는 항목은 비교할 근거가 없으니 같다고 보지 않는다(보인다).
export const isCoveredByWorklog = (
  item: string,
  worklogQuantitative: readonly string[],
): boolean => {
  const numbers = extractNumbers(item);
  if (numbers.length === 0) {
    return false;
  }
  const shown = new Set(worklogQuantitative.flatMap(extractNumbers));
  return numbers.every((number) => shown.has(number));
};

// PO 평가가 합성에 쓴 업무 회고 run 이 이번 다이제스트 스레드에 「정량 근거」를 실었다면 그 목록을,
// 아니면 null 을 돌려준다. 넷 다 맞아야 한다: 같은 run 이다, 저녁 자동 실행이다(수동 /worklog 가
// 아니다), 방금 끝났다(오늘 저녁 work-reviewer 가 실패해 이전 cron run 을 집은 회차가 아니다),
// 정량 근거가 비어 있지 않다. 하나라도 어긋나면 null — careerLog 정량 성과를 그대로 보인다.
// 숫자가 두 번 나오는 쪽이 한 번도 안 나오는 쪽보다 싸다.
export const findQuantitativeShownInDigest = (
  workReviewerRunId: number | undefined,
  latestWorklogRun: SucceededAgentRunSnapshot | undefined,
  now: Date,
): string[] | null => {
  if (workReviewerRunId === undefined || latestWorklogRun === undefined) {
    return null;
  }
  if (latestWorklogRun.id !== workReviewerRunId) {
    return null;
  }
  if (latestWorklogRun.triggerType !== TriggerType.DAILY_EVAL_CRON) {
    return null;
  }
  if (
    now.getTime() - latestWorklogRun.endedAt.getTime() >
    SAME_DIGEST_WINDOW_MS
  ) {
    return null;
  }
  const quantitative = (
    latestWorklogRun.output as { impact?: { quantitative?: unknown } } | null
  )?.impact?.quantitative;
  if (!Array.isArray(quantitative)) {
    return null;
  }
  const items = quantitative.filter(
    (item): item is string => typeof item === 'string',
  );
  return items.length > 0 ? items : null;
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
      const shownQuantitative =
        workReviewerRunId === undefined
          ? null
          : findQuantitativeShownInDigest(
              workReviewerRunId,
              latestWorklogRun,
              new Date(),
            );
      const formatted = formatEvaluationOutput(
        humanized,
        workReviewerRunId !== undefined && shownQuantitative
          ? {
              quantitativeShownElsewhere: {
                workReviewerRunId,
                isShown: (item) => isCoveredByWorklog(item, shownQuantitative),
              },
            }
          : {},
      );
      // 저녁 메인에는 한 줄만 둔다. 평가 요약·Wins·Blockers 는 같은 메시지의 업무 회고 「오늘 한 일」·
      // 저녁 회고 KPT 와 같은 사실을 되풀이해, 메인 중복의 원천이었다(설계 2026-10-02 evening-digest-dedup).
      // 내용은 버리지 않고 스레드 맨 앞으로 옮긴다. 수동 /po-eval 은 이 task 를 거치지 않아 종전대로다.
      const { wins, blockers } = humanized.qualitative;
      const summaryText = `🌅 *Daily Eval — ${firedAtKst} (19:00 KST 자동 회고)* · Wins ${wins.length} · Blockers ${blockers.length} — 내용은 스레드`;
      const detailText = `${formatted.summary}\n\n${formatted.detail}${formatModelFooter(outcome)}`;
      // 메인엔 건수뿐이라 상세가 유일한 사본이다 — 스레드 실패 시 채널로 대피시킨다.
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
