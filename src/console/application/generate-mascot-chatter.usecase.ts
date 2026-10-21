import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  UNTRUSTED_INPUT_NOTICE,
  wrapUntrustedInput,
} from '../../common/llm/untrusted-input.util';
import { formatKstDate } from '../../common/util/kst-date.util';
import { extractJsonObjectText } from '../../common/util/llm-json-extract.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationMemoryService } from '../../router/application/conversation-memory.service';
import { ConversationTurn } from '../../router/domain/conversation-memory.type';
import { CONSOLE_CHANNEL_ID } from '../domain/console-conversation.constant';
import { MascotChatterResult } from '../domain/mascot-chatter.type';
import { WorkSuggestion } from '../domain/work-suggestion.type';
import { BuildPresidentBriefingUsecase } from './build-president-briefing.usecase';
import { SuggestNextWorkUsecase } from './suggest-next-work.usecase';

export const MASCOT_CHATTER_MAX_LENGTH = 80;
const MEMORY_TEXT_MAX_LENGTH = 200;
const MEMORY_TURN_LIMIT = 4;
const TIME_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface GenerateMascotChatterInput {
  declinedAgentTypes: string[];
}

interface ChatterContext {
  conversationKey: string | null;
  todoLines: string[];
  turns: ConversationTurn[];
  candidates: readonly WorkSuggestion[];
}

@Injectable()
export class GenerateMascotChatterUsecase {
  private readonly logger = new Logger(GenerateMascotChatterUsecase.name);
  private inFlight: Promise<MascotChatterResult> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly buildBriefing: BuildPresidentBriefingUsecase,
    private readonly conversationMemory: ConversationMemoryService,
    private readonly suggestNextWork: SuggestNextWorkUsecase,
    private readonly modelRouter: ModelRouterUsecase,
  ) {}

  // 동시에 도착한 요청은 첫 요청의 후보·맥락을 공유한다. 완료 후에는 다음 호출이 새 맥락을 읽는다.
  execute(input: GenerateMascotChatterInput): Promise<MascotChatterResult> {
    if (this.inFlight) {
      return this.inFlight;
    }
    const task = this.generate(input);
    this.inFlight = task;
    const clearInFlight = (): void => {
      if (this.inFlight === task) {
        this.inFlight = null;
      }
    };
    void task.then(clearInFlight, clearInFlight);
    return task;
  }

  private async generate(
    input: GenerateMascotChatterInput,
  ): Promise<MascotChatterResult> {
    const context = await this.collectContext(input);
    const now = new Date();
    const prompt = [
      `현재 KST: ${formatKstDate(now.toISOString())} ${TIME_FORMATTER.format(now)}`,
      '다음은 현재 상황 자료다. 자료에 없는 일은 지어내지 마.',
      wrapUntrustedInput(
        [
          '[할 일]',
          ...context.todoLines,
          '[최근 대화]',
          ...context.turns.map(
            (turn) =>
              `${turn.role === 'assistant' ? '우사기' : '사용자'}: ${turn.text.slice(0, MEMORY_TEXT_MAX_LENGTH)}`,
          ),
          '[제안 후보]',
          ...context.candidates.map(
            (candidate, index) =>
              `${index + 1}. ${candidate.displayName} (${candidate.agentType}): ${candidate.reason}`,
          ),
        ].join('\n'),
      ),
    ].join('\n\n');
    const systemPrompt = [
      '너는 macOS 콘솔의 마스코트 우사기다. 사용자에게 먼저 한 마디를 건넨다.',
      '짧고 밝은 반말(~야, ~해)을 쓰고 존댓말은 섞지 마. 우사기 소리(푸루루, 야하, 우라)는 가끔 문장 중간이나 끝에만 쓰고 첫머리에는 붙이지 마. 화면이 소리를 따로 붙인다.',
      '40자 안팎의 한국어 한 문장만 써. 맥락에 없는 사실을 지어내지 마.',
      '네가 작업을 실행하거나 실행하겠다고 약속하지 마. 제안은 사용자가 선택할 수 있게 물어보기만 해.',
      '제안 후보가 있고 문맥에 어울리면 그 번호를 suggestionIndex로 고를 수 있다. 고르지 않아도 된다.',
      '사용자에게 답을 묻는 질문형 문장이면 asks를 true로 설정해.',
      'JSON 객체 하나만 출력해: {"line": string, "suggestionIndex": number|null, "asks": boolean}.',
      UNTRUSTED_INPUT_NOTICE,
    ].join('\n');

    let responseText: string;
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.PM,
        request: { prompt, systemPrompt },
        noContractPreamble: true,
      });
      responseText = completion.text;
    } catch (error) {
      this.logger.warn(`우사기 한 마디 모델 실패: ${String(error)}`);
      return this.failure('MODEL_FAILED');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObjectText(responseText));
    } catch (error) {
      this.logger.warn(`우사기 한 마디 JSON 파싱 실패: ${String(error)}`);
      return this.failure('INVALID_JSON');
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return this.failure('INVALID_JSON');
    }
    const output = parsed as Record<string, unknown>;
    if (typeof output.line !== 'string') {
      return this.failure('INVALID_LINE');
    }
    const line = output.line.replace(/[\r\n]+/g, ' ').trim();
    if (line.length === 0 || line.length > MASCOT_CHATTER_MAX_LENGTH) {
      return this.failure('INVALID_LINE');
    }
    const index = output.suggestionIndex;
    const validIndex =
      typeof index === 'number' &&
      Number.isInteger(index) &&
      index >= 1 &&
      index <= context.candidates.length;
    if (index !== null && !validIndex) {
      this.logger.debug(`우사기 제안 index 무시: ${String(index)}`);
    }
    const suggestion = validIndex ? context.candidates[index - 1] : null;
    if (context.conversationKey) {
      try {
        await this.conversationMemory.appendTurn(context.conversationKey, {
          role: 'assistant',
          text: line,
          agentType: null,
          agentRunId: null,
          timestampMs: Date.now(),
        });
      } catch (error) {
        this.logger.warn(`우사기 대화 기억 저장 실패: ${String(error)}`);
      }
    }
    return {
      line,
      suggestion,
      asks: typeof output.asks === 'boolean' ? output.asks : false,
    };
  }

  private async collectContext(
    input: GenerateMascotChatterInput,
  ): Promise<ChatterContext> {
    const owner = this.config.get<string>('CONSOLE_OWNER_SLACK_USER_ID');
    const conversationKey = owner
      ? this.conversationMemory.buildKey({
          slackUserId: owner,
          channelId: CONSOLE_CHANNEL_ID,
        })
      : null;
    let todoLines: string[] = [];
    let turns: ConversationTurn[] = [];
    let candidates: readonly WorkSuggestion[] = [];
    try {
      const briefing = await this.buildBriefing.execute();
      todoLines = briefing.todos
        .slice(0, 3)
        .map((todo) => `${todo.kind}: ${todo.label}`);
    } catch (error) {
      this.logger.warn(`우사기 브리핑 조회 실패: ${String(error)}`);
    }
    if (conversationKey) {
      try {
        turns = (
          await this.conversationMemory.getRecentTurns(conversationKey)
        ).slice(-MEMORY_TURN_LIMIT);
      } catch (error) {
        this.logger.warn(`우사기 대화 기억 조회 실패: ${String(error)}`);
      }
    }
    try {
      const result = await this.suggestNextWork.execute();
      const declined = new Set(input.declinedAgentTypes);
      candidates = result.suggestions.filter(
        (suggestion) => !declined.has(suggestion.agentType),
      );
    } catch (error) {
      this.logger.warn(`우사기 제안 조회 실패: ${String(error)}`);
    }
    return { conversationKey, todoLines, turns, candidates };
  }

  private failure(
    reason: NonNullable<MascotChatterResult['reason']>,
  ): MascotChatterResult {
    return { line: null, suggestion: null, asks: false, reason };
  }
}
