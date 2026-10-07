import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import {
  FactAnswer,
  FactAnswerUsecase,
} from '../../../fact-answer/application/fact-answer.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { ConversationTurn } from '../../../router/domain/conversation-memory.type';
import {
  formatBalance,
  formatUsageList,
} from '../../../slack/format/vacation.formatter';
import { computeBalance } from '../domain/balance-calculator';
import {
  addDays,
  comparePlainDate,
  PlainDate,
  plainDateToIso,
} from '../domain/plain-date';
import { VacationBalance } from '../domain/vacation.type';
import { LeaveUsagePrismaRepository } from '../infrastructure/leave-usage.prisma.repository';
import { resolveAccrualPolicy } from './resolve-accrual-policy';
import { resolveHireDate } from './resolve-hire-date';

interface AnswerVacationQuestionCommand {
  slackUserId: string;
  asOf: PlainDate;
  text: string;
  priorTurns: readonly ConversationTurn[];
  // 파서가 낸 판단(가드 보류 사유 포함) — 원장에 남겨 "왜 이 답이 나갔나" 를 되짚는다.
  parsedIntent: Record<string, unknown>;
}

// 휴가 파서가 메뉴 액션으로 처리하지 못한 질문(가정·확인·비교·정정 요청)에, 조회한 휴가 기록으로 답한다.
// 2026-10-07 "8일 기준이라면 4일이 남은게 맞아?" 에 같은 잔여 표가 반복되고, 09-15 "5개 남았어 갱신해줘" 에
// 슬래시 사용법이 나간 문제(docs/superpowers/plans/2026-10-07-nl-answer-fidelity.md §4 3단계).
//
// 잔여 조회 usecase(CalculateBalanceUsecase)를 부르지 않는다 — 그쪽은 action=BALANCE 로 AgentRun 을 열어,
// 이 회차가 "잔여 조회" 로 원장에 둔갑한다. 같은 순수 계산(computeBalance)을 직접 쓴다.
@Injectable()
export class AnswerVacationQuestionUsecase {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: LeaveUsagePrismaRepository,
    private readonly agentRunService: AgentRunService,
    private readonly factAnswer: FactAnswerUsecase,
  ) {}

  async execute({
    slackUserId,
    asOf,
    text,
    priorTurns,
    parsedIntent,
  }: AnswerVacationQuestionCommand): Promise<AgentRunOutcome<FactAnswer>> {
    return this.agentRunService.execute({
      agentType: AgentType.VACATION,
      triggerType: TriggerType.SLACK_COMMAND_VACATION,
      inputSnapshot: {
        slackUserId,
        action: 'UNKNOWN',
        asOf: plainDateToIso(asOf),
        parsedIntent,
      },
      evidence: [],
      run: async () => {
        // 조회가 실패하면 그대로 실패로 끝낸다 — 근거 없이 답할 수는 없다.
        const hireDate = resolveHireDate(this.config);
        const policy = resolveAccrualPolicy(this.config);
        const usages = await this.repository.findActiveByUser(slackUserId);
        const current = computeBalance({ hireDate, asOf, policy, usages });
        // 직전 회기는 비교 질문("작년보다")의 근거다. 입사 첫 회기면 없다.
        const previous =
          comparePlainDate(current.periodStart, hireDate) > 0
            ? computeBalance({
                hireDate,
                asOf: addDays(current.periodStart, -1),
                policy,
                usages,
              })
            : null;
        const facts = {
          today: plainDateToIso(asOf),
          hireDate: plainDateToIso(hireDate),
          currentPeriod: summarizePeriod(current),
          previousPeriod: previous === null ? null : summarizePeriod(previous),
          usages: usages.map((usage) => ({
            id: usage.id,
            start: plainDateToIso(usage.startDate),
            end: plainDateToIso(usage.endDate),
            days: usage.businessDays,
            memo: usage.memo,
          })),
          howToChange:
            '부여 일수(1년차 선지급 포함)는 대화로 바꿀 수 없고 설정 VACATION_FIRST_YEAR_ADVANCE_DAYS 를 고쳐야 반영된다. 사용 기록은 "2026-10-20 휴가 등록해줘", "휴가 5번 취소해줘" 처럼 말하면 바뀐다.',
        };
        const answer = await this.factAnswer.answer({
          agentType: AgentType.VACATION,
          text,
          priorTurns,
          facts,
          fallbackText: [
            formatBalance(current),
            '',
            formatUsageList(usages),
          ].join('\n'),
        });
        return {
          result: answer,
          modelUsed: answer.modelUsed,
          output: {
            facts,
            reply: answer.text,
            usedFallback: answer.usedFallback,
            ...(answer.numberCheck !== undefined
              ? { numberCheck: answer.numberCheck }
              : {}),
            ...(answer.answerError !== undefined
              ? { answerError: answer.answerError }
              : {}),
          },
        };
      },
    });
  }
}

const summarizePeriod = (balance: VacationBalance) => ({
  start: plainDateToIso(balance.periodStart),
  end: plainDateToIso(balance.periodEnd),
  granted: balance.grantedDays,
  used: balance.usedDays,
  remaining: balance.remainingDays,
});
