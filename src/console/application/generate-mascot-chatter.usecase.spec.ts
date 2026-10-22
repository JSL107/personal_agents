import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import {
  UNTRUSTED_INPUT_END,
  UNTRUSTED_INPUT_NOTICE,
  UNTRUSTED_INPUT_START,
} from '../../common/llm/untrusted-input.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../model-router/domain/model-router.type';
import { ConversationMemoryService } from '../../router/application/conversation-memory.service';
import { ConsoleTodoKind } from '../domain/briefing.type';
import { CONSOLE_CHANNEL_ID } from '../domain/console-conversation.constant';
import { BuildPresidentBriefingUsecase } from './build-president-briefing.usecase';
import { ConsoleReadService } from './console-read.service';
import { GenerateMascotChatterUsecase } from './generate-mascot-chatter.usecase';
import { SuggestNextWorkUsecase } from './suggest-next-work.usecase';

const OWNER_ID = 'U_OWNER';
const MEMORY_KEY = `${OWNER_ID}:${CONSOLE_CHANNEL_ID}`;
const FIRST_SUGGESTION = {
  agentType: AgentType.PM,
  displayName: 'PM',
  reason: '오늘 계획을 세울 차례',
};
const SECOND_SUGGESTION = {
  agentType: AgentType.CODE_REVIEWER,
  displayName: '코드 리뷰어',
  reason: '검토할 PR이 남음',
};

const completion = (text: string): CompletionResponse => ({
  text,
  modelUsed: 'test-model',
  provider: ModelProviderName.CHATGPT,
});

describe('GenerateMascotChatterUsecase', () => {
  let usecase: GenerateMascotChatterUsecase;
  let modelRouter: { route: jest.Mock };
  let briefing: { execute: jest.Mock };
  let suggestions: { execute: jest.Mock };
  let runs: { findFinishedRunsSince: jest.Mock; findActiveRuns: jest.Mock };
  let consoleRead: { getSnapshot: jest.Mock };
  let memory: {
    buildKey: jest.Mock;
    getRecentTurns: jest.Mock;
    appendTurn: jest.Mock;
  };

  beforeEach(async () => {
    modelRouter = {
      route: jest
        .fn()
        .mockResolvedValue(
          completion(
            '{"line":"오늘 할 일을 살펴볼까?","suggestionIndex":1,"asks":true}',
          ),
        ),
    };
    briefing = {
      execute: jest.fn().mockResolvedValue({
        todos: [
          {
            kind: ConsoleTodoKind.APPROVAL,
            label: '승인 1건',
            detail: '',
            targets: [],
          },
        ],
      }),
    };
    suggestions = {
      execute: jest.fn().mockResolvedValue({
        suggestions: [FIRST_SUGGESTION, SECOND_SUGGESTION],
        skippedUnknownCycle: 0,
        alsoDueCount: 0,
      }),
    };
    runs = {
      findFinishedRunsSince: jest.fn().mockResolvedValue([]),
      findActiveRuns: jest.fn().mockResolvedValue([]),
    };
    consoleRead = {
      getSnapshot: jest.fn().mockResolvedValue({
        agents: [{ agentType: AgentType.PM, displayName: '기획 담당' }],
      }),
    };
    memory = {
      buildKey: jest.fn().mockReturnValue(MEMORY_KEY),
      getRecentTurns: jest.fn().mockResolvedValue([]),
      appendTurn: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GenerateMascotChatterUsecase,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'CONSOLE_OWNER_SLACK_USER_ID' ? OWNER_ID : undefined,
            ),
          },
        },
        { provide: BuildPresidentBriefingUsecase, useValue: briefing },
        { provide: ConversationMemoryService, useValue: memory },
        { provide: SuggestNextWorkUsecase, useValue: suggestions },
        { provide: ModelRouterUsecase, useValue: modelRouter },
        { provide: AgentRunService, useValue: runs },
        { provide: ConsoleReadService, useValue: consoleRead },
      ],
    }).compile();
    usecase = moduleRef.get(GenerateMascotChatterUsecase);
  });

  it('정상 JSON의 한 마디와 후보를 매핑하고 표시 확인 전에는 기억하지 않는다', async () => {
    const result = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'IDLE',
    });

    expect(result).toEqual({
      chatterId: expect.any(String),
      line: '오늘 할 일을 살펴볼까?',
      suggestion: FIRST_SUGGESTION,
      asks: true,
      hasEvents: false,
    });
    expect(memory.buildKey).toHaveBeenCalledWith({
      slackUserId: OWNER_ID,
      channelId: CONSOLE_CHANNEL_ID,
    });
    expect(memory.appendTurn).not.toHaveBeenCalled();
    expect(await usecase.confirmShown(result.chatterId!)).toBe(true);
    expect(memory.appendTurn).toHaveBeenCalledWith(MEMORY_KEY, {
      role: 'assistant',
      text: '오늘 할 일을 살펴볼까?',
      agentType: null,
      agentRunId: null,
      timestampMs: expect.any(Number),
    });
  });

  it('코드펜스와 앞뒤 설명이 섞인 JSON도 추출한다', async () => {
    modelRouter.route.mockResolvedValue(
      completion(
        '아래 한 마디야.\n```json\n{"line":"잠깐 쉬어도 좋아!","suggestionIndex":null,"asks":false}\n```\n이상!',
      ),
    );

    const result = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'IDLE',
    });

    expect(result).toEqual({
      chatterId: expect.any(String),
      line: '잠깐 쉬어도 좋아!',
      suggestion: null,
      asks: false,
      hasEvents: false,
    });
  });

  it.each([0, 3, 1.5, '1'])(
    '후보 범위 밖이거나 정수가 아닌 suggestionIndex %s는 버리고 한 마디는 유지한다',
    async (suggestionIndex) => {
      modelRouter.route.mockResolvedValue(
        completion(
          JSON.stringify({
            line: '같이 살펴보자!',
            suggestionIndex,
            asks: false,
          }),
        ),
      );

      const result = await usecase.execute({
        declinedAgentTypes: [],
        trigger: 'IDLE',
      });

      expect(result).toEqual({
        chatterId: expect.any(String),
        line: '같이 살펴보자!',
        suggestion: null,
        asks: false,
        hasEvents: false,
      });
      expect(memory.appendTurn).not.toHaveBeenCalled();
    },
  );

  it('81자인 line은 자르지 않고 INVALID_LINE으로 처리하며 기억하지 않는다', async () => {
    modelRouter.route.mockResolvedValue(
      completion(
        JSON.stringify({
          line: '가'.repeat(81),
          suggestionIndex: 1,
          asks: true,
        }),
      ),
    );

    const result = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'IDLE',
    });

    expect(result).toEqual({
      chatterId: null,
      line: null,
      suggestion: null,
      asks: false,
      hasEvents: false,
      reason: 'INVALID_LINE',
    });
    expect(memory.appendTurn).not.toHaveBeenCalled();
  });

  it('깨진 JSON은 INVALID_JSON으로 돌려주고 기억하지 않는다', async () => {
    modelRouter.route.mockResolvedValue(completion('{"line":'));

    await expect(
      usecase.execute({ declinedAgentTypes: [], trigger: 'IDLE' }),
    ).resolves.toEqual({
      chatterId: null,
      line: null,
      suggestion: null,
      asks: false,
      hasEvents: false,
      reason: 'INVALID_JSON',
    });
    expect(memory.appendTurn).not.toHaveBeenCalled();
  });

  it('line의 CR과 LF를 공백으로 바꾸고 asks가 boolean이 아니면 false로 둔다', async () => {
    modelRouter.route.mockResolvedValue(
      completion(JSON.stringify({ line: '앞\r뒤\n끝', asks: 'true' })),
    );

    const result = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'IDLE',
    });

    expect(result).toEqual({
      chatterId: expect.any(String),
      line: '앞 뒤 끝',
      suggestion: null,
      asks: false,
      hasEvents: false,
    });
  });

  it('모델 호출 예외는 MODEL_FAILED 결과로 돌려준다', async () => {
    modelRouter.route.mockRejectedValue(new Error('model unavailable'));

    await expect(
      usecase.execute({ declinedAgentTypes: [], trigger: 'IDLE' }),
    ).resolves.toEqual({
      chatterId: null,
      line: null,
      suggestion: null,
      asks: false,
      hasEvents: false,
      reason: 'MODEL_FAILED',
    });
    expect(memory.appendTurn).not.toHaveBeenCalled();
  });

  it('알 수 없는 ID와 두 번째 확인은 기억하지 않는다', async () => {
    const result = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'IDLE',
    });

    expect(await usecase.confirmShown('unknown')).toBe(false);
    expect(memory.appendTurn).not.toHaveBeenCalled();
    expect(await usecase.confirmShown(result.chatterId!)).toBe(true);
    expect(await usecase.confirmShown(result.chatterId!)).toBe(false);
    expect(memory.appendTurn).toHaveBeenCalledTimes(1);
  });

  it('5분이 지난 한 마디는 기억하지 않는다', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const result = await usecase.execute({
        declinedAgentTypes: [],
        trigger: 'IDLE',
      });
      now.mockReturnValue(1_000 + 5 * 60 * 1000);

      expect(await usecase.confirmShown(result.chatterId!)).toBe(false);
      expect(memory.appendTurn).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('새 한 마디가 이전 표시 대기 항목을 대체한다', async () => {
    const first = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'IDLE',
    });
    const second = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'IDLE',
    });

    expect(first.chatterId).not.toBe(second.chatterId);
    expect(await usecase.confirmShown(first.chatterId!)).toBe(false);
    expect(await usecase.confirmShown(second.chatterId!)).toBe(true);
    expect(memory.appendTurn).toHaveBeenCalledTimes(1);
  });

  it('기억 저장이 실패하면 false를 반환하고 재시도해 중복 저장하지 않는다', async () => {
    memory.appendTurn.mockRejectedValue(new Error('memory unavailable'));
    const result = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'IDLE',
    });

    expect(await usecase.confirmShown(result.chatterId!)).toBe(false);
    expect(await usecase.confirmShown(result.chatterId!)).toBe(false);
    expect(memory.appendTurn).toHaveBeenCalledTimes(1);
  });

  it('거절한 후보를 프롬프트에서 빼고 남은 후보를 1번으로 매핑한다', async () => {
    const result = await usecase.execute({
      declinedAgentTypes: [AgentType.PM],
      trigger: 'IDLE',
    });

    expect(result.suggestion).toEqual(SECOND_SUGGESTION);
    const request = modelRouter.route.mock.calls[0][0] as {
      request: { prompt: string };
    };
    expect(request.request.prompt).toContain(SECOND_SUGGESTION.reason);
    expect(request.request.prompt).not.toContain(FIRST_SUGGESTION.reason);
  });

  it('브리핑과 제안 조회가 실패해도 모델의 한 마디는 생성한다', async () => {
    briefing.execute.mockRejectedValue(new Error('briefing unavailable'));
    suggestions.execute.mockRejectedValue(new Error('suggestions unavailable'));

    const result = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'IDLE',
    });

    expect(result.line).toBe('오늘 할 일을 살펴볼까?');
    expect(result.suggestion).toBeNull();
    expect(modelRouter.route).toHaveBeenCalledTimes(1);
  });

  it('진행 중인 두 요청은 모델 호출 하나를 공유한다', async () => {
    let releaseCompletion: (value: CompletionResponse) => void = () =>
      undefined;
    const pendingCompletion = new Promise<CompletionResponse>((resolve) => {
      releaseCompletion = resolve;
    });
    modelRouter.route.mockReturnValue(pendingCompletion);

    const first = usecase.execute({ declinedAgentTypes: [], trigger: 'IDLE' });
    const second = usecase.execute({ declinedAgentTypes: [], trigger: 'IDLE' });
    releaseCompletion(
      completion(
        '{"line":"오늘도 잘하고 있어!","suggestionIndex":null,"asks":false}',
      ),
    );
    const results = await Promise.all([first, second]);

    expect(modelRouter.route).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[1]);
  });

  it('외부 맥락은 untrusted 마커로 감싸고 systemPrompt에 NOTICE를 둔다', async () => {
    memory.getRecentTurns.mockResolvedValue([
      {
        role: 'user',
        text: '방금 그 작업은 어떻게 됐어?',
        agentType: null,
        agentRunId: null,
        timestampMs: Date.now(),
      },
    ]);

    await usecase.execute({ declinedAgentTypes: [], trigger: 'IDLE' });

    const call = modelRouter.route.mock.calls[0][0] as {
      agentType: AgentType;
      noContractPreamble: boolean;
      request: { prompt: string; systemPrompt: string; outputSchema?: unknown };
    };
    expect(call.agentType).toBe(AgentType.PM);
    expect(call.noContractPreamble).toBe(true);
    expect(call.request.outputSchema).toBeUndefined();
    expect(call.request.prompt).toContain(UNTRUSTED_INPUT_START);
    expect(call.request.prompt).toContain(UNTRUSTED_INPUT_END);
    expect(call.request.prompt).toContain('승인 1건');
    expect(call.request.prompt).toContain('방금 그 작업은 어떻게 됐어?');
    expect(call.request.prompt).toContain(FIRST_SUGGESTION.reason);
    expect(call.request.systemPrompt).toContain(UNTRUSTED_INPUT_NOTICE);
  });

  it('EVENTS에 보고할 종료 작업이 없으면 모델을 호출하지 않는다', async () => {
    runs.findFinishedRunsSince.mockResolvedValue([
      {
        runId: 1,
        agentType: AgentType.HUMANIZER,
        triggerType: 'REPORT_HUMANIZE',
        status: 'SUCCEEDED',
        endedAt: new Date(),
        summary: null,
      },
    ]);

    const result = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'EVENTS',
    });

    expect(result).toEqual({
      chatterId: null,
      line: null,
      suggestion: null,
      asks: false,
      hasEvents: false,
      reason: 'NOTHING_TO_SAY',
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('EVENTS는 최대 6건을 표시명과 함께 untrusted 블록에 넣는다', async () => {
    runs.findFinishedRunsSince.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        runId: index + 1,
        agentType: AgentType.PM,
        triggerType: 'SLACK_COMMAND_TODAY',
        status: 'SUCCEEDED',
        endedAt: new Date(),
        summary: `요약${index + 1}`,
      })),
    );

    const result = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'EVENTS',
    });

    expect(result.hasEvents).toBe(true);
    const request = modelRouter.route.mock.calls[0][0].request as {
      prompt: string;
      systemPrompt: string;
    };
    const untrusted = request.prompt
      .split(UNTRUSTED_INPUT_START)[1]
      .split(UNTRUSTED_INPUT_END)[0];
    expect(untrusted).toContain('[끝난 일] 기획 담당 성공');
    expect(untrusted).toContain('요약6');
    expect(untrusted).not.toContain('요약7');
    expect(request.systemPrompt).toContain('끝난 일');
  });

  it('RETURN은 120자를 허용하고 121자는 INVALID_LINE으로 처리한다', async () => {
    modelRouter.route.mockResolvedValueOnce(
      completion(
        JSON.stringify({ line: '가'.repeat(120), suggestionIndex: null }),
      ),
    );
    const valid = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'RETURN',
    });
    expect(valid.line).toHaveLength(120);
    expect(valid.hasEvents).toBe(false);

    modelRouter.route.mockResolvedValueOnce(
      completion(
        JSON.stringify({ line: '가'.repeat(121), suggestionIndex: null }),
      ),
    );
    const invalid = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'RETURN',
    });
    expect(invalid.reason).toBe('INVALID_LINE');
  });

  it('PROGRESS는 2분 넘은 실행이 없으면 모델을 호출하지 않는다', async () => {
    runs.findActiveRuns.mockResolvedValue([
      { agentType: AgentType.PM, startedAt: new Date(Date.now() - 90_000) },
    ]);

    const result = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'PROGRESS',
    });

    expect(result.reason).toBe('NOTHING_TO_SAY');
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('끝난 일 조회가 실패하면 말할 거리 없음과 구분해 CONTEXT_FAILED 로 답하고 모델을 부르지 않는다', async () => {
    runs.findFinishedRunsSince.mockRejectedValue(new Error('db unavailable'));

    const result = await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'EVENTS',
    });

    expect(result.reason).toBe('CONTEXT_FAILED');
    expect(result.line).toBeNull();
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('since가 미래 또는 24시간보다 오래되면 24시간 전으로 제한한다', async () => {
    const now = Date.now();
    runs.findFinishedRunsSince.mockResolvedValue([]);

    await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'EVENTS',
      since: new Date(now + 60_000),
    });
    await usecase.execute({
      declinedAgentTypes: [],
      trigger: 'EVENTS',
      since: new Date(now - 25 * 60 * 60_000),
    });

    for (const [query] of runs.findFinishedRunsSince.mock.calls) {
      expect(query.limit).toBe(200);
      expect(query.since.getTime()).toBeGreaterThanOrEqual(
        now - 24 * 60 * 60_000 - 1_000,
      );
      expect(query.since.getTime()).toBeLessThanOrEqual(
        now - 24 * 60 * 60_000 + 1_000,
      );
    }
  });

  it('다른 trigger 동시 호출은 각각 생성하고 같은 trigger만 공유한다', async () => {
    let releaseCompletion: (value: CompletionResponse) => void = () =>
      undefined;
    const pendingCompletion = new Promise<CompletionResponse>((resolve) => {
      releaseCompletion = resolve;
    });
    modelRouter.route.mockReturnValue(pendingCompletion);
    runs.findFinishedRunsSince.mockResolvedValue([
      {
        runId: 1,
        agentType: AgentType.PM,
        triggerType: null,
        status: 'FAILED',
        endedAt: new Date(),
        summary: '실패',
      },
    ]);

    const idle = usecase.execute({ declinedAgentTypes: [], trigger: 'IDLE' });
    const events = usecase.execute({
      declinedAgentTypes: [],
      trigger: 'EVENTS',
    });
    const duplicate = usecase.execute({
      declinedAgentTypes: [],
      trigger: 'EVENTS',
    });
    releaseCompletion(completion('{"line":"보고할게","suggestionIndex":null}'));
    await Promise.all([idle, events, duplicate]);

    expect(modelRouter.route).toHaveBeenCalledTimes(2);
  });

  describe('호출 결과 로그', () => {
    let log: jest.SpyInstance;
    let warn: jest.SpyInstance;

    beforeEach(() => {
      log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    afterEach(() => {
      log.mockRestore();
      warn.mockRestore();
    });

    const resultLines = (): string[] =>
      log.mock.calls
        .map(([message]) => String(message))
        .filter((message) => message.startsWith('우사기 한 마디 —'));

    it('성공은 계기와 글자 수를, 실패는 사유를 한 줄 남긴다', async () => {
      modelRouter.route.mockResolvedValueOnce(
        completion('{"line":"안녕","suggestionIndex":null}'),
      );
      await usecase.execute({ declinedAgentTypes: [], trigger: 'IDLE' });
      runs.findFinishedRunsSince.mockResolvedValue([]);
      await usecase.execute({ declinedAgentTypes: [], trigger: 'EVENTS' });

      expect(resultLines()).toEqual([
        '우사기 한 마디 — 계기 IDLE · 성공 2자',
        '우사기 한 마디 — 계기 EVENTS · NOTHING_TO_SAY',
      ]);
    });

    it('진행 중인 요청을 공유한 호출도 한 줄 남기고, 생성 결과는 한 번만 남긴다', async () => {
      let releaseCompletion: (value: CompletionResponse) => void = () =>
        undefined;
      modelRouter.route.mockReturnValue(
        new Promise<CompletionResponse>((resolve) => {
          releaseCompletion = resolve;
        }),
      );

      const first = usecase.execute({
        declinedAgentTypes: [],
        trigger: 'IDLE',
      });
      const shared = usecase.execute({
        declinedAgentTypes: [],
        trigger: 'IDLE',
      });
      releaseCompletion(completion('{"line":"안녕","suggestionIndex":null}'));
      await Promise.all([first, shared]);

      expect(resultLines()).toEqual([
        '우사기 한 마디 — 계기 IDLE · 진행 중인 요청 결과 공유',
        '우사기 한 마디 — 계기 IDLE · 성공 2자',
      ]);
    });

    it('생성이 예외로 끝나면 경고를 남기고 예외를 그대로 던진다', async () => {
      const failure = new Error('boom');
      jest
        .spyOn(
          usecase as unknown as { generate: () => Promise<unknown> },
          'generate',
        )
        .mockRejectedValueOnce(failure);

      await expect(
        usecase.execute({ declinedAgentTypes: [], trigger: 'IDLE' }),
      ).rejects.toBe(failure);
      expect(warn).toHaveBeenCalledWith(
        '우사기 한 마디 — 계기 IDLE · 예외 Error: boom',
      );
    });
  });
});
