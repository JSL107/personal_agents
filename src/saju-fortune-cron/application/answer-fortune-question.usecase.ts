import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { dayPillarOf } from '../domain/day-pillar';
import { formatSpecialDayFacts } from '../domain/saju-extra-fortune.prompt';
import {
  buildFortuneFollowUpPrompt,
  FortuneChatTurn,
  FortuneMessageKind,
  fortuneMessageOf,
} from '../domain/saju-fortune-chat';
import {
  parseSajuFortuneRecipients,
  SajuFortuneRecipient,
} from '../domain/saju-fortune-cron.type';
import {
  countUnremovableViolations,
  findFortuneViolations,
} from '../domain/saju-fortune-render';
import { specialDaysOf } from '../domain/special-day';
import { formatWeeklyFacts } from '../domain/weekly-fortune';
import { specialDayContextOf } from './special-day-calendar';
import { weeklyScoresOf } from './weekly-scores';
import { yearMonthPillarsOf } from './year-month-pillar';

// 아침 발송과 같은 기준 — 코드가 지울 수 없는 위반(한자·용어)만 본다.
const hasHanjaOrTerm = (text: string): boolean => {
  const violations = findFortuneViolations(text);
  return countUnremovableViolations(violations) > 0;
};

export interface AnswerFortuneQuestionInput {
  slackUserId: string;
  // 스레드 부모 메시지 = 아침 운세 DM 원문.
  fortuneMessageText: string;
  priorTurns: FortuneChatTurn[];
  question: string;
}

// 운세 DM 스레드에 단 질문에 답한다. 그날 일진·사실은 아침 발송과 같은 코드로 다시 계산한다 —
// 날짜와 사주만 있으면 결정되는 값이라 따로 저장할 필요가 없다.
// LLM 은 아침 발송과 같은 이유로 PM 을 빌린다(saju-fortune-cron.consumer 주석 참조).
@Injectable()
export class AnswerFortuneQuestionUsecase {
  private readonly logger = new Logger(AnswerFortuneQuestionUsecase.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly modelRouter: ModelRouterUsecase,
  ) {}

  // 운세 DM 이 아니거나 받는 사람 목록에 없으면 null — 호출부가 일반 대화로 넘긴다.
  async answer({
    slackUserId,
    fortuneMessageText,
    priorTurns,
    question,
  }: AnswerFortuneQuestionInput): Promise<string | null> {
    const fortuneMessage = fortuneMessageOf(fortuneMessageText);
    if (!fortuneMessage) {
      return null;
    }
    const { date: fortuneDate, kind } = fortuneMessage;
    const recipient = parseSajuFortuneRecipients(
      this.configService.get<string>('SAJU_FORTUNE_RECIPIENTS'),
    ).recipients.find((candidate) => candidate.slackUserId === slackUserId);
    if (!recipient) {
      return null;
    }

    const prompt = buildFortuneFollowUpPrompt({
      recipient,
      fortuneDate,
      fortunePillar: dayPillarOf(fortuneDate),
      yearMonthPillars: yearMonthPillarsOf(fortuneDate),
      originalFortune: fortuneMessageText,
      ...extraFactsOf({ recipient, fortuneDate, kind }),
      priorTurns,
      question,
    });
    // 한자·명리 용어가 섞이면 한 번만 다시 만든다. 별·행운 숫자는 보지 않는다 — 스레드는 아침 메시지의
    // 별점·아이템을 인용해 답할 수 있어야 한다.
    const first = await this.complete(prompt);
    if (!hasHanjaOrTerm(first)) {
      return first;
    }
    const second = await this.complete(prompt);
    if (hasHanjaOrTerm(second)) {
      this.logger.warn(
        `운세 대화 한자·용어 섞인 응답 — 재생성 후에도 남아 그대로 답함 (${slackUserId})`,
      );
    }
    return second;
  }

  private async complete(prompt: string): Promise<string> {
    const completion = await this.modelRouter.route({
      agentType: AgentType.PM,
      request: { prompt },
      noContractPreamble: true,
    });
    const text = completion.text.trim();
    if (text.length === 0) {
      throw new Error('운세 대화 응답이 비어 있음');
    }
    return text;
  }
}

interface ExtraFollowUpFacts {
  specialFacts: string[];
  weeklyFacts: string[];
}

// 특별한 날 사실은 메시지 종류와 무관하게 그날이면 싣는다 — 월요일+생일 합본은 머리말이 "이번 주 운세" 라도
// 생일 이야기가 들어 있다. 이번 주 사실은 주간 메시지에 단 답일 때만.
const extraFactsOf = ({
  recipient,
  fortuneDate,
  kind,
}: {
  recipient: SajuFortuneRecipient;
  fortuneDate: string;
  kind: FortuneMessageKind;
}): ExtraFollowUpFacts => {
  const context = specialDayContextOf(fortuneDate);
  const days = specialDaysOf({
    todayKst: fortuneDate,
    birthday: recipient.birthday,
    context,
  });
  const specialFacts = formatSpecialDayFacts({ days, recipient, context });
  const weeklyFacts =
    kind === 'weekly'
      ? [
          '- 이번 주(월~일) 항목별 좋은 날·조심할 날:',
          ...formatWeeklyFacts(
            weeklyScoresOf({
              natalPillars: recipient.natalPillars,
              mondayKst: fortuneDate,
            }),
          ),
        ]
      : [];
  return { specialFacts, weeklyFacts };
};
