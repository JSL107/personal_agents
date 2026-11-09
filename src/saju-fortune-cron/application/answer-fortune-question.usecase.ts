import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { dayPillarOf } from '../domain/day-pillar';
import {
  buildFortuneFollowUpPrompt,
  FortuneChatTurn,
  fortuneDateOf,
  HANJA_PATTERN,
} from '../domain/saju-fortune-chat';
import { parseSajuFortuneRecipients } from '../domain/saju-fortune-cron.type';
import { yearMonthPillarsOf } from './year-month-pillar';

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
    const fortuneDate = fortuneDateOf(fortuneMessageText);
    if (!fortuneDate) {
      return null;
    }
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
      priorTurns,
      question,
    });
    // 한자가 섞이면 한 번만 다시 만든다 — 아침 발송과 같은 기준.
    const first = await this.complete(prompt);
    if (!HANJA_PATTERN.test(first)) {
      return first;
    }
    const second = await this.complete(prompt);
    if (HANJA_PATTERN.test(second)) {
      this.logger.warn(
        `운세 대화 한자 섞인 응답 — 재생성 후에도 남아 그대로 답함 (${slackUserId})`,
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
