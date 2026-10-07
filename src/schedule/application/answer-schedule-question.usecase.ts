import { Injectable } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import {
  FactAnswer,
  FactAnswerUsecase,
} from '../../fact-answer/application/fact-answer.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationTurn } from '../../router/domain/conversation-memory.type';
import { ScheduleItemRecord } from '../domain/schedule.type';
import { ListSchedulesUsecase } from './list-schedules.usecase';

interface AnswerScheduleQuestionCommand {
  slackUserId: string;
  now: Date;
  text: string;
  priorTurns: readonly ConversationTurn[];
  parsedIntent: Record<string, unknown>;
}

// 사실로 넘기는 일정 범위 — 지난 2주(놓친 마감 확인용)와 앞으로 두 달.
const LOOKBACK_DAYS = 14;
const LOOKAHEAD_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

// 일정 워커가 등록하지 않은 질문("9월 30일 자동차세 맞아?", "이번주 일정 뭐 있어?")에 등록된 일정으로 답한다.
// 자연어로 일정을 볼 길이 없던 문제(ListSchedulesUsecase 가 dispatcher 에 연결돼 있지 않았다)를 고친다.
// (plan: docs/superpowers/plans/2026-10-07-nl-answer-fidelity.md §4 3단계)
@Injectable()
export class AnswerScheduleQuestionUsecase {
  constructor(
    private readonly listSchedules: ListSchedulesUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly factAnswer: FactAnswerUsecase,
  ) {}

  async execute({
    slackUserId,
    now,
    text,
    priorTurns,
    parsedIntent,
  }: AnswerScheduleQuestionCommand): Promise<AgentRunOutcome<FactAnswer>> {
    return this.agentRunService.execute({
      agentType: AgentType.SCHEDULE,
      triggerType: TriggerType.SLACK_MENTION_SCHEDULE,
      inputSnapshot: { slackUserId, action: 'UNKNOWN', parsedIntent },
      evidence: [],
      run: async () => {
        const records = await this.listSchedules.execute({
          slackUserId,
          from: new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS),
          to: new Date(now.getTime() + LOOKAHEAD_DAYS * DAY_MS),
        });
        // 공휴일 동기화가 넣은 행은 사용자가 등록한 일정이 아니다.
        const schedules = records.filter((record) => !record.isHoliday);
        const facts = {
          today: toIsoDate(now),
          range: {
            from: toIsoDate(new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)),
            to: toIsoDate(new Date(now.getTime() + LOOKAHEAD_DAYS * DAY_MS)),
          },
          schedules: schedules.map((record) => ({
            title: record.title,
            due: toIsoDate(record.dueDate),
            dueTime: record.dueTime,
            status: record.status,
          })),
          howToRegister:
            '"9월 30일 자동차세 등록해줘" 처럼 날짜와 이름을 함께 말하면 등록된다.',
        };
        const answer = await this.factAnswer.answer({
          agentType: AgentType.SCHEDULE,
          text,
          priorTurns,
          facts,
          fallbackText: formatScheduleFacts(schedules),
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

const formatScheduleFacts = (schedules: ScheduleItemRecord[]): string =>
  schedules.length === 0
    ? '등록된 일정이 없어요.'
    : [
        '*📅 등록된 일정*',
        ...schedules.map(
          (record) =>
            `• ${toIsoDate(record.dueDate)} ${record.title} (${record.status})`,
        ),
      ].join('\n');
