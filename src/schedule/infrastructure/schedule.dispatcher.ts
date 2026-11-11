import { Inject, Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  findHypotheticalMarker,
  formatHeldWrite,
} from '../../router/domain/hypothetical-utterance';
import { DispatchInput } from '../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../router/domain/port/agent-dispatcher.port';
import {
  formatNeedsDate,
  formatNeedsTitle,
  formatScheduleRegistered,
  formatSchedulesRegistered,
} from '../../slack/format/schedule.formatter';
import { AnswerScheduleQuestionUsecase } from '../application/answer-schedule-question.usecase';
import {
  ExtractedSchedule,
  ExtractScheduleFromConversationUsecase,
} from '../application/extract-schedule-from-conversation.usecase';
import { ManageScheduleFromConversationUsecase } from '../application/manage-schedule-from-conversation.usecase';
import { RegisterScheduleUsecase } from '../application/register-schedule.usecase';
import { findByTitle } from '../domain/find-by-title';
import { hasManagementMarker } from '../domain/management-intent';
import { parseDueDate, todayInKst } from '../domain/parse-due-date';
import {
  mergeScheduleCommands,
  parseScheduleCommand,
  parseScheduleList,
  ScheduleCommand,
} from '../domain/parse-schedule-command';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { refersToPriorConversation } from '../domain/prior-conversation-reference';
import { ScheduleException } from '../domain/schedule.exception';
import { PlainDate, ScheduleItemRecord } from '../domain/schedule.type';
import { ScheduleErrorCode } from '../domain/schedule-error-code.enum';
import {
  hasScheduleWriteIntent,
  isScheduleLookup,
} from '../domain/schedule-lookup';

interface RegisterFromConversationInput {
  input: DispatchInput;
  extracted: ExtractedSchedule;
  today: PlainDate;
}

type RegisterCommand = Extract<ScheduleCommand, { kind: 'REGISTER' }>;

interface ParseListInput {
  input: DispatchInput;
  command: ScheduleCommand;
  mergedPriorText?: string;
  today: PlainDate;
}

interface RegisterListInput {
  input: DispatchInput;
  list: ScheduleCommand[];
}

interface MergedScheduleCommand {
  command: ScheduleCommand;
  mergedPriorText?: string;
}

@Injectable()
export class ScheduleDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.SCHEDULE;
  private readonly logger = new Logger(ScheduleDispatcher.name);

  constructor(
    private readonly registerSchedule: RegisterScheduleUsecase,
    private readonly answerQuestion: AnswerScheduleQuestionUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly extractSchedule: ExtractScheduleFromConversationUsecase,
    private readonly manageSchedule: ManageScheduleFromConversationUsecase,
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    // 빈 문장은 되묻기 대신 BAD_REQUEST — 콘솔이 입력 요청으로 바꿔 다음 입력을 이 worker 로 잇는다.
    if (!input.text?.trim()) {
      throw new ScheduleException({
        code: ScheduleErrorCode.INPUT_REQUIRED,
        message:
          '등록할 일정을 날짜와 이름으로 적어주세요 (예: 9월 30일 자동차세).',
        status: DomainStatus.BAD_REQUEST,
      });
    }
    const today = todayInKst(new Date());
    if (hasManagementMarker(input.text)) {
      const candidates = await this.repository.findUnfinished({
        slackUserId: input.slackUserId,
      });
      if (
        findByTitle({ items: candidates, query: input.text }).kind !== 'NONE'
      ) {
        const marker = findHypotheticalMarker(input.text);
        if (marker !== null) {
          return this.answer(input, today, { kind: 'LOOKUP' });
        }
        return this.manageSchedule.execute({ input, candidates });
      }
    }
    // 조회 문장은 등록 파서에 넣지 않는다 — 문장 전체가 제목으로 읽혀 날짜를 되묻거나("이번주 일정
    // 알려줘") 바로 등록된다("오늘 할 일"). 등록된 일정으로 답한다.
    if (isScheduleLookup(input.text ?? '')) {
      return this.answer(input, today, { kind: 'LOOKUP' });
    }
    const { command, mergedPriorText } = this.withPriorTurn(
      parseScheduleCommand(input.text ?? '', today),
      input,
      today,
    );

    // 되묻기보다 먼저, 합치는 데 쓴 직전 턴까지 본다. "자동차세 등록해도 돼?" 가 날짜 되묻기로
    // 빠진 뒤 다음 턴 "9월 30일" 과 합쳐지면, 이번 원문만 봐서는 질문이었다는 걸 모른다.
    const marker =
      findHypotheticalMarker(input.text ?? '') ??
      (mergedPriorText === undefined
        ? null
        : findHypotheticalMarker(mergedPriorText));
    if (marker !== null) {
      this.logger.warn(
        `일정 ${command.kind} 보류 — 질문·가정형 원문 (표지=${marker})`,
      );
      // 등록은 하지 않되 질문에는 등록된 일정으로 답한다. 제목은 질문 원문에서 뽑혀 "맞아?" 같은
      // 꼬리가 섞일 수 있어 등록 안내에는 예시 문장을 쓴다.
      return this.answer(
        input,
        today,
        { ...command, heldWrite: { action: 'REGISTER', marker } },
        formatHeldWrite('일정을 등록', '9월 30일 자동차세 등록해줘'),
      );
    }

    // 목록은 대화 참조("이렇게 두 건")보다 먼저 본다 — 등록할 내용이 메시지에 다 적혀 있다.
    const list = this.parseList({ input, command, mergedPriorText, today });
    if (list !== null) {
      return this.registerList({ input, list });
    }

    const reference = refersToPriorConversation(input.text);
    const priorTurns = input.priorTurns ?? [];
    // 모델 추출은 직전 대화를 가리키는 요청일 때만 켠다. 대화 본문이 DM 24시간 기록이라 이대리 답은
    // 거의 항상 있어서, 날짜만 빠진 평범한 요청("자동차세 등록해줘")에도 켜면 앞 대화의 무관한 날짜로
    // 되묻지 않고 등록된다. 평범한 요청은 지금처럼 규칙 파서와 되묻기로 처리한다.
    const hasIdaeriReply = priorTurns.some((turn) => turn.role === 'assistant');
    // 대화를 일정으로 옮기는 등록은 쓰기 동사가 있을 때만 한다. "그럼 이중에 남은일정을 파악해볼래" 처럼
    // 지시어만 있는 질문이 모델 추출을 거쳐 "11월 남은 일정 파악" 으로 등록됐다(2026-11-03 실행 #11278).
    // 쓰기 동사도 날짜도 없는 참조는 질문으로 보고 답한다 — 파서로 넘기면 문장 전체가 제목이 돼 날짜를
    // 되묻는다. 날짜를 준 참조("그럼 9월 30일")와 직전 요청에 합쳐 등록이 완성되는 제목 답("원인 분석",
    // #957 리뷰)은 되묻기 후속이라 지금처럼 대화에서 뽑는다.
    const asksAboutConversation =
      command.kind !== 'REGISTER' &&
      !hasScheduleWriteIntent(input.text) &&
      parseDueDate(input.text, today) === null;
    if (reference && hasIdaeriReply && asksAboutConversation) {
      return this.answer(input, today, { kind: 'LOOKUP' });
    }
    if (reference && hasIdaeriReply) {
      const extracted = await this.extractSchedule.execute({
        text: input.text,
        priorTurns,
        today,
      });
      if (extracted) {
        return this.registerFromConversation({ input, extracted, today });
      }
      // 참조 요청인데 추출이 실패하면 파서 결과("원인과 함께" 같은 제목)로 등록하지 않는다.
      return this.toOutcome(
        command,
        '직전 대화 내용을 읽지 못했어요. 제목을 알려 주세요.',
      );
    }

    if (command.kind === 'NEEDS_TITLE') {
      return this.toOutcome(command, formatNeedsTitle());
    }
    if (command.kind === 'NEEDS_DATE') {
      // 되묻기는 Router 의 multi-turn 메모리(5턴·TTL 30분)가 다음 발화를 이 워커로 이어 준다.
      return this.toOutcome(command, formatNeedsDate(command.title));
    }

    // 등록은 DB 에 쓰는 부작용이라 AgentRun 을 남긴다. 되묻기(NEEDS_*)는 한 일이 없어 남기지 않는다.
    // RegisterScheduleUsecase 를 감싸지 않는 이유: 공휴일 동기화·콘솔 등록도 같은 usecase 를 지난다.
    const outcome = await this.agentRunService.execute({
      agentType: AgentType.SCHEDULE,
      triggerType: TriggerType.SLACK_MENTION_SCHEDULE,
      inputSnapshot: {
        slackUserId: input.slackUserId,
        action: 'REGISTER',
        title: command.title,
        dueDate: command.dueDate,
      },
      run: async () => {
        const record = await this.registerSchedule.execute({
          slackUserId: input.slackUserId,
          title: command.title,
          dueDate: command.dueDate,
        });
        return {
          result: record,
          modelUsed: 'deterministic',
          // 제목·마감일을 함께 싣는다 — id 만 남기면 episodic 인덱스에 계측만 쌓인다.
          output: {
            scheduleId: record.id,
            title: record.title,
            dueDate: record.dueDate,
          },
        };
      },
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatScheduleRegistered(outcome.result),
    };
  }

  private async registerFromConversation({
    input,
    extracted,
    today,
  }: RegisterFromConversationInput): Promise<DispatchOutcome> {
    const dueDate = extracted.dueDate ?? today;
    const outcome = await this.agentRunService.execute({
      agentType: AgentType.SCHEDULE,
      triggerType: TriggerType.SLACK_MENTION_SCHEDULE,
      inputSnapshot: {
        slackUserId: input.slackUserId,
        action: 'REGISTER',
        title: extracted.title,
        dueDate,
        source: 'CONVERSATION',
        hasMemo: extracted.memo.length > 0,
      },
      run: async () => {
        const record = await this.registerSchedule.execute({
          slackUserId: input.slackUserId,
          title: extracted.title,
          dueDate,
          memo: extracted.memo,
        });
        return {
          result: record,
          modelUsed: extracted.modelUsed,
          output: {
            scheduleId: record.id,
            title: record.title,
            dueDate: record.dueDate,
          },
        };
      },
    });
    // 대화에서 날짜를 못 찾아 오늘로 채웠으면 그 사실을 답에 밝힌다.
    const dateDefaulted = extracted.dueDate === null;
    const formattedText = formatScheduleRegistered(outcome.result, {
      dateDefaulted,
      memo: extracted.memo,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText,
    };
  }

  // 이번 원문이 목록이면 그것을, 아니면 날짜 되묻기로 합친 직전 턴의 목록을 읽는다. 직전 턴 목록은
  // 이번에 받은 날짜를 날짜 없는 항목에 붙인다 — 안 그러면 되묻기 뒤 목록이 다시 한 건으로 합쳐진다.
  private parseList({
    input,
    command,
    mergedPriorText,
    today,
  }: ParseListInput): ScheduleCommand[] | null {
    // 제목 되묻기("내일 일정 등록해줘")에 목록으로 답하면 직전 턴의 날짜를 잇는다(#1024 리뷰).
    // 직전 턴이 제목을 기다리던 때만 — 등록이 끝난 턴의 날짜를 새 목록에 붙이지 않는다.
    const priorCommand =
      mergedPriorText === undefined
        ? null
        : parseScheduleCommand(mergedPriorText, today);
    const awaitedTitleDate =
      priorCommand?.kind === 'NEEDS_TITLE' ? priorCommand.dueDate : undefined;
    const current = parseScheduleList({
      text: input.text ?? '',
      today,
      fallbackDate: awaitedTitleDate,
    });
    if (current !== null || mergedPriorText === undefined) {
      return current;
    }
    // 직전 목록은 그 목록이 날짜를 기다리고 있었고 이번 답이 날짜뿐일 때만 잇는다. 이미 등록한 목록
    // 뒤에 온 "여권 등록해줘" 가 그 목록을 다시 등록하면 안 된다.
    const prior = parseScheduleList({ text: mergedPriorText, today });
    const awaitingDate =
      prior?.some((item) => item.kind === 'NEEDS_DATE') ?? false;
    const dateOnly =
      parseScheduleCommand(input.text ?? '', today).kind === 'NEEDS_TITLE';
    if (!awaitingDate || !dateOnly || command.kind === 'NEEDS_DATE') {
      return null;
    }
    return parseScheduleList({
      text: mergedPriorText,
      today,
      fallbackDate: command.dueDate,
    });
  }

  private async registerList({
    input,
    list,
  }: RegisterListInput): Promise<DispatchOutcome> {
    const items = list.filter(
      (command): command is RegisterCommand => command.kind === 'REGISTER',
    );
    // 한 건이라도 날짜가 없으면 아무것도 등록하지 않고 묻는다. 일부만 등록하면 날짜 답이 온 뒤
    // 이미 등록한 항목이 한 번 더 등록된다.
    if (items.length < list.length) {
      const titles = list.map((command) =>
        command.kind === 'NEEDS_TITLE' ? '' : command.title,
      );
      const question = formatNeedsDate(titles.join(', '));
      return this.toOutcome({ kind: 'NEEDS_DATE', titles }, question);
    }
    const outcome = await this.agentRunService.execute({
      agentType: AgentType.SCHEDULE,
      triggerType: TriggerType.SLACK_MENTION_SCHEDULE,
      inputSnapshot: {
        slackUserId: input.slackUserId,
        action: 'REGISTER',
        items: items.map(({ title, dueDate }) => ({ title, dueDate })),
      },
      run: async () => {
        const records: ScheduleItemRecord[] = [];
        for (const { title, dueDate } of items) {
          records.push(
            await this.registerSchedule.execute({
              slackUserId: input.slackUserId,
              title,
              dueDate,
            }),
          );
        }
        return {
          result: records,
          modelUsed: 'deterministic',
          output: {
            scheduleIds: records.map((record) => record.id),
            items: records.map(({ title, dueDate }) => ({ title, dueDate })),
          },
        };
      },
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatSchedulesRegistered(outcome.result),
    };
  }

  private async answer(
    input: DispatchInput,
    today: PlainDate,
    parsedIntent: Record<string, unknown>,
    notice?: string,
  ): Promise<DispatchOutcome> {
    const outcome = await this.answerQuestion.execute({
      slackUserId: input.slackUserId,
      today,
      text: input.text ?? '',
      priorTurns: input.priorTurns ?? [],
      parsedIntent,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: { ...parsedIntent, usedFallback: outcome.result.usedFallback },
      modelUsed: outcome.modelUsed,
      formattedText:
        notice === undefined
          ? outcome.result.text
          : `${outcome.result.text}\n\n${notice}`,
    };
  }

  /**
   * 되묻기 후속 발화에는 빠졌던 쪽만 담겨 온다("9월 30일"). Router 의 multi-turn 메모리가 그
   * 발화를 이 워커로 이어 주지만 **본문은 새 발화뿐**이라, 직전 SCHEDULE 턴을 다시 읽어 합치지
   * 않으면 제목과 날짜를 번갈아 되물으며 대화가 끝나지 않는다.
   *
   * 현재 발화는 아직 메모리에 없다 — `router-message.handler` 가 dispatch 뒤에 `appendTurn`
   * 하므로, 마지막 SCHEDULE user 턴이 곧 직전 되묻기 턴이다. 합치는 데 쓴 그 턴의 원문도 함께
   * 돌려준다 — 쓰기 가드가 앞 턴이 질문이었는지 봐야 한다.
   */
  private withPriorTurn(
    command: ScheduleCommand,
    input: DispatchInput,
    today: PlainDate,
  ): MergedScheduleCommand {
    if (command.kind === 'REGISTER') {
      return { command };
    }
    const prior = [...(input.priorTurns ?? [])]
      .reverse()
      .find(
        (turn) =>
          turn.agentType === AgentType.SCHEDULE &&
          (turn.role ?? 'user') === 'user' &&
          turn.text.trim().length > 0,
      );
    // 가장 가까운 SCHEDULE 턴이 조회 질문이면 그 자체가 등록 흐름의 경계다. 조회 턴만 건너뛰고 더
    // 거슬러 올라가면, 그 전의 미완료 등록("자동차세 등록해줘")이 이번 날짜와 합쳐져 등록된다(#753 리뷰).
    if (!prior || isScheduleLookup(prior.text)) {
      return { command };
    }
    return {
      command: mergeScheduleCommands(
        parseScheduleCommand(prior.text, today),
        command,
      ),
      mergedPriorText: prior.text,
    };
  }

  private toOutcome(output: unknown, formattedText: string): DispatchOutcome {
    return { agentRunId: 0, output, modelUsed: 'deterministic', formattedText };
  }
}
