import { Inject, Injectable } from '@nestjs/common';

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
import { PlainDate, plainDateToIso } from '../../vacation/domain/plain-date';
import { APPLICATION_STATUSES } from '../domain/job-application.type';
import {
  JOB_APPLICATION_REPOSITORY_PORT,
  JobApplicationRepositoryPort,
} from '../domain/port/job-application.repository.port';
import { formatApplicationList } from '../infrastructure/job-application.formatter';

interface AnswerJobQuestionCommand {
  slackUserId: string;
  today: PlainDate;
  text: string;
  priorTurns: readonly ConversationTurn[];
  parsedIntent: Record<string, unknown>;
}

// 지원 추적 파서가 메뉴 액션으로 처리하지 못한 질문(집계·확인·가정)에, 지원 기록으로 답한다.
// (plan: docs/superpowers/plans/2026-10-07-nl-answer-fidelity.md §4 3단계)
@Injectable()
export class AnswerJobQuestionUsecase {
  constructor(
    @Inject(JOB_APPLICATION_REPOSITORY_PORT)
    private readonly repository: JobApplicationRepositoryPort,
    private readonly agentRunService: AgentRunService,
    private readonly factAnswer: FactAnswerUsecase,
  ) {}

  async execute({
    slackUserId,
    today,
    text,
    priorTurns,
    parsedIntent,
  }: AnswerJobQuestionCommand): Promise<AgentRunOutcome<FactAnswer>> {
    return this.agentRunService.execute({
      agentType: AgentType.JOB_APPLICATION,
      triggerType: TriggerType.SLACK_MENTION_JOB_APPLICATION,
      inputSnapshot: {
        slackUserId,
        action: 'UNKNOWN',
        today: plainDateToIso(today),
        parsedIntent,
      },
      evidence: [],
      run: async () => {
        const records = await this.repository.listByUser(slackUserId);
        // 모든 상태를 0 으로 채운다 — 키가 없으면 "오퍼 0개" 라는 맞는 답이 숫자 검사에 걸린다.
        const countsByStatus: Record<string, number> = Object.fromEntries(
          APPLICATION_STATUSES.map((status) => [status, 0]),
        );
        for (const record of records) {
          countsByStatus[record.status] =
            (countsByStatus[record.status] ?? 0) + 1;
        }
        const appliedThisMonth = records.filter(
          (record) =>
            record.appliedAt.year === today.year &&
            record.appliedAt.month === today.month,
        ).length;
        const facts = {
          today: plainDateToIso(today),
          total: records.length,
          appliedThisMonth,
          // "지금 지원하면 몇 번째야?" 의 답은 +1 이다. 숫자 검사는 합·차만 허용해 +1 을 모델이 계산하면
          // 근거 없는 값으로 걸리므로, 정해진 계산은 코드가 해서 넣는다(가정형 질문의 결정론 값).
          ifAppliedNow: {
            ordinal: records.length + 1,
            ordinalThisMonth: appliedThisMonth + 1,
          },
          countsByStatus,
          applications: records.map((record) => ({
            company: record.company,
            role: record.role,
            status: record.status,
            appliedAt: plainDateToIso(record.appliedAt),
            deadline:
              record.deadline === null ? null : plainDateToIso(record.deadline),
          })),
          statusMeaning:
            'APPLIED=지원함, SCREENING=서류심사, INTERVIEW=면접, OFFER=오퍼, REJECTED=불합격, WITHDRAWN=지원취소',
        };
        const answer = await this.factAnswer.answer({
          agentType: AgentType.JOB_APPLICATION,
          text,
          priorTurns,
          facts,
          fallbackText: formatApplicationList(records),
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
