import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

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
      ],
    }).compile();
    usecase = moduleRef.get(GenerateMascotChatterUsecase);
  });

  it('정상 JSON의 한 마디와 후보를 매핑하고 대화 기억에 남긴다', async () => {
    const result = await usecase.execute({ declinedAgentTypes: [] });

    expect(result).toEqual({
      line: '오늘 할 일을 살펴볼까?',
      suggestion: FIRST_SUGGESTION,
      asks: true,
    });
    expect(memory.buildKey).toHaveBeenCalledWith({
      slackUserId: OWNER_ID,
      channelId: CONSOLE_CHANNEL_ID,
    });
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

    const result = await usecase.execute({ declinedAgentTypes: [] });

    expect(result).toEqual({
      line: '잠깐 쉬어도 좋아!',
      suggestion: null,
      asks: false,
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

      const result = await usecase.execute({ declinedAgentTypes: [] });

      expect(result).toEqual({
        line: '같이 살펴보자!',
        suggestion: null,
        asks: false,
      });
      expect(memory.appendTurn).toHaveBeenCalledTimes(1);
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

    const result = await usecase.execute({ declinedAgentTypes: [] });

    expect(result).toEqual({
      line: null,
      suggestion: null,
      asks: false,
      reason: 'INVALID_LINE',
    });
    expect(memory.appendTurn).not.toHaveBeenCalled();
  });

  it('깨진 JSON은 INVALID_JSON으로 돌려주고 기억하지 않는다', async () => {
    modelRouter.route.mockResolvedValue(completion('{"line":'));

    await expect(usecase.execute({ declinedAgentTypes: [] })).resolves.toEqual({
      line: null,
      suggestion: null,
      asks: false,
      reason: 'INVALID_JSON',
    });
    expect(memory.appendTurn).not.toHaveBeenCalled();
  });

  it('line의 CR과 LF를 공백으로 바꾸고 asks가 boolean이 아니면 false로 둔다', async () => {
    modelRouter.route.mockResolvedValue(
      completion(JSON.stringify({ line: '앞\r뒤\n끝', asks: 'true' })),
    );

    const result = await usecase.execute({ declinedAgentTypes: [] });

    expect(result).toEqual({ line: '앞 뒤 끝', suggestion: null, asks: false });
  });

  it('모델 호출 예외는 MODEL_FAILED 결과로 돌려준다', async () => {
    modelRouter.route.mockRejectedValue(new Error('model unavailable'));

    await expect(usecase.execute({ declinedAgentTypes: [] })).resolves.toEqual({
      line: null,
      suggestion: null,
      asks: false,
      reason: 'MODEL_FAILED',
    });
    expect(memory.appendTurn).not.toHaveBeenCalled();
  });

  it('거절한 후보를 프롬프트에서 빼고 남은 후보를 1번으로 매핑한다', async () => {
    const result = await usecase.execute({
      declinedAgentTypes: [AgentType.PM],
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

    const result = await usecase.execute({ declinedAgentTypes: [] });

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

    const first = usecase.execute({ declinedAgentTypes: [] });
    const second = usecase.execute({ declinedAgentTypes: [] });
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

    await usecase.execute({ declinedAgentTypes: [] });

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
});
