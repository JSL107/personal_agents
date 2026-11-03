import { Logger } from '@nestjs/common';

import {
  UNTRUSTED_INPUT_NOTICE,
  UNTRUSTED_INPUT_START,
  wrapUntrustedInput,
} from '../../common/llm/untrusted-input.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import {
  AgentType,
  ModelProviderName,
} from '../../model-router/domain/model-router.type';
import { PreferenceProfilePort } from '../../preference-profile/domain/port/preference-profile.port';
import { AUTO_POST_LABEL } from '../domain/auto-post-turn';
import { buildIntentClassificationOutputSchema } from '../domain/prompt/intent-classification.schema';
import { INTENT_CLASSIFIER_SYSTEM_PROMPT } from '../domain/prompt/intent-classifier-system.prompt';
import { IntentClassifierUsecase } from './intent-classifier.usecase';

const makeModelRouterMock = (
  responseText: string,
): jest.Mocked<ModelRouterUsecase> =>
  ({
    route: jest.fn().mockResolvedValue({
      text: responseText,
      modelUsed: 'gpt-5-mock',
      provider: ModelProviderName.CHATGPT,
    }),
  }) as unknown as jest.Mocked<ModelRouterUsecase>;

// few-shot 필터 기준이자 분류 스키마의 후보 목록 — 사용자가 실제로 부를 수 있는 worker 만 담는다.
const DISPATCHER_AGENT_TYPES = [AgentType.CODE_REVIEWER, AgentType.PM];
const dispatchers = DISPATCHER_AGENT_TYPES.map((agentType) => ({
  agentType,
  dispatch: jest.fn(),
})) as never;

describe('IntentClassifierUsecase', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('LLM 응답을 IntentClassification 으로 반환', async () => {
    const modelRouter = makeModelRouterMock(
      JSON.stringify({
        agentType: 'CODE_REVIEWER',
        confidence: 0.85,
        reason: '구현 요청',
      }),
    );
    const usecase = new IntentClassifierUsecase(modelRouter, dispatchers);

    const result = await usecase.classify({
      text: '백엔드에서 user repository 만들어줘',
    });

    expect(result.agentType).toBe(AgentType.CODE_REVIEWER);
    expect(result.confidence).toBe(0.85);
    expect(result.reason).toBe('구현 요청');
  });

  it('ModelRouter.route 가 AgentType.PM 의 provider 와 system prompt 로 호출된다', async () => {
    const modelRouter = makeModelRouterMock(
      JSON.stringify({ agentType: 'PM', confidence: 0.9, reason: '' }),
    );
    const usecase = new IntentClassifierUsecase(modelRouter, dispatchers);

    await usecase.classify({ text: '  오늘 plan  ' });

    expect(modelRouter.route).toHaveBeenCalledWith({
      agentType: AgentType.PM,
      request: {
        prompt: '오늘 plan',
        systemPrompt: INTENT_CLASSIFIER_SYSTEM_PROMPT,
        // 형태 강제를 프롬프트 지시가 아니라 모델 호출 인자로 넘긴다 — 이 필드가 빠지면
        // 분류기가 다시 "지켜주길 바라는" 상태로 돌아가므로 명시적으로 고정한다.
        // 후보는 등록 dispatcher 에서 파생되므로 여기서도 같은 소스로 기대값을 만든다.
        outputSchema: buildIntentClassificationOutputSchema(
          DISPATCHER_AGENT_TYPES,
        ),
      },
      // PM 은 provider 선택용 차용이라 계약 머리말을 끈다 — 붙으면 분류기가 기대하는
      // 고정 JSON 스키마와 충돌한다.
      noContractPreamble: true,
    });
  });

  it('UNKNOWN 도 정상 반환 — manager 가 자체 분기 처리', async () => {
    const modelRouter = makeModelRouterMock(
      JSON.stringify({
        agentType: 'UNKNOWN',
        confidence: 0,
        reason: '의도 모호',
      }),
    );
    const usecase = new IntentClassifierUsecase(modelRouter, dispatchers);

    const result = await usecase.classify({ text: '어쩌고 저쩌고' });

    expect(result.agentType).toBe('UNKNOWN');
  });

  describe('episodic few-shot 주입', () => {
    const beResponse = JSON.stringify({
      agentType: 'CODE_REVIEWER',
      confidence: 0.9,
      reason: 'r',
    });

    it('episodic 주입 시 [유사 과거 작업] 섹션을 프롬프트에 포함한다', async () => {
      const modelRouter = makeModelRouterMock(beResponse);
      const episodic = {
        record: jest.fn(),
        searchRelevant: jest.fn().mockResolvedValue([
          {
            id: 1,
            agentRunId: 11,
            agentType: 'CODE_REVIEWER',
            content: '결제 모듈 PG 리팩토링',
            score: 0.8,
            similarity: 0.88,
            occurredAt: new Date(),
          },
        ]),
      };
      const usecase = new IntentClassifierUsecase(
        modelRouter,
        dispatchers,
        episodic as never,
      );

      await usecase.classify({ text: 'PG 연동 손봐줘' });

      // 출력 JSON(agent_run)이 아니라 요청문 짝(routing_example)을, 감쇠 없이 정확 검색한다.
      expect(episodic.searchRelevant).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'routing_example',
          halfLifeDays: Number.POSITIVE_INFINITY,
          exact: true,
        }),
      );
      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt).toContain('[유사 과거 작업]');
      expect(prompt).toContain('worker CODE_REVIEWER');
    });

    // AgentRunService 는 성공한 run 의 output 을 전부 episodic 에 적재한다. 그 안에는 사용자가
    // 부를 수 없는 내부 계측 실행도 섞이는데, 예시로 들어가면 classifier 가 미등록 agentType 을
    // 답하고 라우터가 UNSUPPORTED_AGENT_TYPE 으로 사용자 요청을 실패시킨다.
    it('dispatcher 미등록 worker 의 과거 실행은 few-shot 에서 제외한다', async () => {
      const modelRouter = makeModelRouterMock(beResponse);
      const episodic = {
        record: jest.fn(),
        searchRelevant: jest.fn().mockResolvedValue([
          {
            id: 1,
            agentRunId: 11,
            agentType: 'HUMANIZER',
            content: '{"humanizedKeys":["summary"]}',
            score: 0.9,
            similarity: 0.9,
            occurredAt: new Date(),
          },
          {
            id: 2,
            agentRunId: 12,
            agentType: 'CODE_REVIEWER',
            content: '결제 모듈 PG 리팩토링',
            score: 0.7,
            similarity: 0.85,
            occurredAt: new Date(),
          },
        ]),
      };
      const usecase = new IntentClassifierUsecase(
        modelRouter,
        dispatchers,
        episodic as never,
      );

      await usecase.classify({ text: 'PG 연동 손봐줘' });

      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt).toContain('worker CODE_REVIEWER');
      expect(prompt).not.toContain('HUMANIZER');
      expect(prompt).not.toContain('humanizedKeys');
    });

    it('episodic 미주입 시 기존 프롬프트(섹션 없음)로 분류한다', async () => {
      const modelRouter = makeModelRouterMock(beResponse);
      const usecase = new IntentClassifierUsecase(
        modelRouter,
        dispatchers,
        undefined,
      );

      await usecase.classify({ text: 'PG 연동 손봐줘' });

      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt).not.toContain('[유사 과거 작업]');
    });

    it('episodic 검색이 throw 해도 분류는 정상 진행한다 (best-effort)', async () => {
      const modelRouter = makeModelRouterMock(beResponse);
      const episodic = {
        record: jest.fn(),
        searchRelevant: jest.fn().mockRejectedValue(new Error('embed down')),
      };
      const usecase = new IntentClassifierUsecase(
        modelRouter,
        dispatchers,
        episodic as never,
      );

      const result = await usecase.classify({ text: 'PG 연동 손봐줘' });

      expect(result.agentType).toBe(AgentType.CODE_REVIEWER);
      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt).not.toContain('[유사 과거 작업]');
    });
  });

  describe('preference profile routing 주입', () => {
    const beResponse = JSON.stringify({
      agentType: 'CODE_REVIEWER',
      confidence: 0.9,
      reason: 'r',
    });

    it('프로필 주입 시 systemPrompt 에 라우팅 힌트가 포함된다', async () => {
      const routingHint = '사용자 지칭 습관 힌트:\n- "그거 분배" → CTO';
      const preferenceProfile: PreferenceProfilePort = {
        getInjectionBlock: jest.fn().mockResolvedValue(routingHint),
      };
      const modelRouter = makeModelRouterMock(beResponse);
      const usecase = new IntentClassifierUsecase(
        modelRouter,
        dispatchers,
        undefined,
        preferenceProfile,
      );

      await usecase.classify({ text: '그거 분배해줘' });

      const callArg = modelRouter.route.mock.calls[0][0];
      expect(callArg.request.systemPrompt).toContain(routingHint);
      expect(callArg.request.systemPrompt).toContain(
        INTENT_CLASSIFIER_SYSTEM_PROMPT,
      );
    });

    it('프로필 미주입 시 기존 systemPrompt 로 호출된다', async () => {
      const modelRouter = makeModelRouterMock(beResponse);
      const usecase = new IntentClassifierUsecase(
        modelRouter,
        dispatchers,
        undefined,
        undefined,
      );

      await usecase.classify({ text: '그거 분배해줘' });

      const callArg = modelRouter.route.mock.calls[0][0];
      expect(callArg.request.systemPrompt).toBe(
        INTENT_CLASSIFIER_SYSTEM_PROMPT,
      );
    });
  });

  // 시스템 프롬프트는 "[assistant] 는 봇 자신의 직전 응답" 을 계약으로 두고 「합의된 작업의 실행
  // 지시」/「순수 재촉」 규칙을 분기시킨다. 렌더링이 그 라벨을 실제로 붙이지 않으면 두 규칙이
  // 통째로 죽는다 — 봇 발화가 사용자 발화로 둔갑해 대화 맥락이 반대로 읽히기 때문.
  describe('[직전 대화] role 라벨 렌더링', () => {
    const unknownResponse = JSON.stringify({
      agentType: 'UNKNOWN',
      confidence: 0,
      reason: 'r',
    });

    it('assistant turn 은 [assistant] 로, user turn 은 [user] + worker 태그로 렌더링된다', async () => {
      const modelRouter = makeModelRouterMock(unknownResponse);
      const usecase = new IntentClassifierUsecase(modelRouter, dispatchers);

      await usecase.classify({
        text: '프롬프트 RAG',
        priorTurns: [
          {
            role: 'user',
            text: '더 딥다이브 가능해?',
            agentType: AgentType.CODE_REVIEWER,
            agentRunId: 42,
            timestampMs: Date.now(),
          },
          {
            role: 'assistant',
            text: '가능해요. 어떤 주제인지 한 문장으로 짚어주세요.',
            agentType: AgentType.CODE_REVIEWER,
            agentRunId: 42,
            timestampMs: Date.now(),
          },
        ],
      });

      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt).toContain(
        '[user] "더 딥다이브 가능해?" → worker CODE_REVIEWER #42',
      );
      expect(prompt).toContain(
        '[assistant] "가능해요. 어떤 주제인지 한 문장으로 짚어주세요."',
      );
      // 회귀 방지 — 봇 발화가 "사용자:" 로 렌더링되면 분류기가 화자를 반대로 읽는다.
      expect(prompt).not.toContain('사용자: "가능해요');
      // assistant turn 의 agentType 은 직전 user turn 의 미러 — worker 태그를 붙이지 않는다.
      expect(prompt).not.toMatch(/\[assistant\][^\n]*worker CODE_REVIEWER/);
    });

    it('role 미설정(legacy turn)은 user 로 해석한다', async () => {
      const modelRouter = makeModelRouterMock(unknownResponse);
      const usecase = new IntentClassifierUsecase(modelRouter, dispatchers);

      await usecase.classify({
        text: '그거 분배해',
        priorTurns: [
          {
            text: '오늘 plan 짜줘',
            agentType: AgentType.PM,
            agentRunId: 7,
            timestampMs: Date.now(),
          },
        ],
      });

      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt).toContain('[user] "오늘 plan 짜줘" → worker PM #7');
    });
  });

  describe('자동 발송 글 렌더링', () => {
    const response = JSON.stringify({
      agentType: 'UNKNOWN',
      confidence: 0,
      reason: '',
    });
    const makeTurn = (text: string, agentType: AgentType | null = null) => ({
      role: 'user' as const,
      text,
      agentType,
      agentRunId: null,
      timestampMs: Date.now(),
    });

    it('최근 10턴만 싣는다', async () => {
      const modelRouter = makeModelRouterMock(response);
      const usecase = new IntentClassifierUsecase(modelRouter, dispatchers);
      await usecase.classify({
        text: '이번 입력',
        priorTurns: Array.from({ length: 12 }, (_, index) =>
          makeTurn(`턴-${index}`),
        ),
      });
      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt).not.toContain('"턴-0"');
      expect(prompt).not.toContain('"턴-1"');
      expect(prompt).toContain('"턴-2"');
      expect(prompt).toContain('"턴-11"');
    });

    it('자동 발송 글이 있으면 system prompt 에 UNTRUSTED_INPUT_NOTICE 를 싣는다', async () => {
      const modelRouter = makeModelRouterMock(response);
      const usecase = new IntentClassifierUsecase(modelRouter, dispatchers);
      await usecase.classify({
        text: '이번 입력',
        priorTurns: [
          makeTurn(`${AUTO_POST_LABEL}\n${wrapUntrustedInput('아침신문')}`),
        ],
      });
      expect(modelRouter.route.mock.calls[0][0].request.systemPrompt).toContain(
        UNTRUSTED_INPUT_NOTICE,
      );
    });

    it('자동 발송 글 턴은 [자동 발송 글] 로 앞 300자까지 싣고 worker 꼬리를 달지 않는다', async () => {
      const modelRouter = makeModelRouterMock(response);
      const usecase = new IntentClassifierUsecase(modelRouter, dispatchers);
      await usecase.classify({
        text: '이번 입력',
        priorTurns: [
          makeTurn(
            `${AUTO_POST_LABEL}\n${wrapUntrustedInput('가'.repeat(350))}`,
            AgentType.PM,
          ),
        ],
      });
      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt).toContain('[자동 발송 글]');
      expect(prompt).toContain('가'.repeat(300));
      expect(prompt).not.toContain('가'.repeat(301));
      expect(prompt).not.toContain('worker PM');
    });

    it('일반 user 턴은 지금처럼 60자·worker 꼬리 유지', async () => {
      const modelRouter = makeModelRouterMock(response);
      const usecase = new IntentClassifierUsecase(modelRouter, dispatchers);
      await usecase.classify({
        text: '이번 입력',
        priorTurns: [makeTurn('나'.repeat(80), AgentType.PM)],
      });
      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt).toContain(`"${'나'.repeat(60)}…" → worker PM -`);
    });

    it('경계 마커 뒤 본문이 렌더에 남는다', async () => {
      const modelRouter = makeModelRouterMock(response);
      const usecase = new IntentClassifierUsecase(modelRouter, dispatchers);
      await usecase.classify({
        text: '이번 입력',
        priorTurns: [
          makeTurn(
            `${AUTO_POST_LABEL}\n${wrapUntrustedInput('오늘의 도구 내용')}`,
          ),
        ],
      });
      const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(prompt.indexOf('오늘의 도구 내용')).toBeGreaterThan(
        prompt.indexOf(UNTRUSTED_INPUT_START),
      );
    });
  });
});

// 결함 A (맥락 결합 실패, 2026-07-02) — "PR URL + 접근해봐" 처럼 직전 대화에서 합의된 작업의
// 실행 지시가 재촉으로 오인돼 UNKNOWN 으로 새던 문제. system prompt 상수에 신규 규칙 문구가
// 유지되는지만 검증한다(문자열 회귀 방지). 실제 분류 정확도는 LLM 런타임이라 유닛으로 보장 불가.
describe('INTENT_CLASSIFIER_SYSTEM_PROMPT — 합의된 작업 실행 지시 인식 (결함 A)', () => {
  it('직전 합의 작업 + 필요한 입력을 주며 실행 지시하면 UNKNOWN 아닌 해당 worker 로 매핑하는 규칙이 있다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toMatch(/실행을 지시하면/);
    // 실제 문제 사례의 지시 표현이 예시로 명시돼 LLM 이 패턴을 인식할 수 있어야 한다.
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toContain('접근해봐');
    // 이번 입력에 명시 동사가 없어도 직전 대화의 의도로 worker 를 결정하라.
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toMatch(
      /직전 대화의 의도로 worker 를 결정하라/,
    );
  });

  it('순수 재촉(새 입력 없이 진행 상태만 물음)은 여전히 UNKNOWN 으로 남긴다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toMatch(/진행 상태만\s+묻는/);
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toContain('UNKNOWN');
  });
});

describe('INTENT_CLASSIFIER_SYSTEM_PROMPT — 기술 학습·조사 요청 BLOG 착지', () => {
  it('구체적 기술 주제의 공부·조사·딥다이브 요청을 BLOG 로 분류하는 규칙이 있다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toMatch(
      /특정 기술 주제.*공부.*조사.*딥다이브.*BLOG/s,
    );
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toContain('프롬프트 RAG 공부할래');
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toContain('서버 컴포넌트 딥다이브');
  });

  it('기술 주제가 구체적이면 BLOG, 주제가 없으면 UNKNOWN 인 경계를 명시한다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toMatch(/구체적 기술 주제.*BLOG/s);
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toContain('공부하고 싶어');
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toContain('뭐 좀 알려줘');
  });

  it('봇이 제안한 선택지에서 사용자가 기술 주제를 고르면 BLOG 착수 지시로 분류한다', () => {
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toContain('[user] "프롬프트 RAG"');
    expect(INTENT_CLASSIFIER_SYSTEM_PROMPT).toMatch(/선택.*착수 지시.*BLOG/s);
  });

  describe('라우팅 기억 단축', () => {
    const llmResponse = JSON.stringify({
      agentType: 'PM',
      confidence: 0.8,
      reason: 'llm',
    });
    // 서로 다른 두 문장이 모두 0.97 이상이고 같은 담당 — MEMORY_SHORTCUT_RULE(T=0.93, k=2)을 넘는다.
    const agreeingHits = [
      {
        id: 1,
        agentRunId: 11,
        agentType: 'CODE_REVIEWER',
        content: 'PR 리뷰해줘',
        score: 0.98,
        similarity: 0.98,
        occurredAt: new Date(),
      },
      {
        id: 2,
        agentRunId: 12,
        agentType: 'CODE_REVIEWER',
        content: '이 PR 봐줘',
        score: 0.97,
        similarity: 0.97,
        occurredAt: new Date(),
      },
    ];
    const build = (mode: string | undefined) => {
      const modelRouter = makeModelRouterMock(llmResponse);
      const episodic = {
        record: jest.fn().mockResolvedValue(undefined),
        searchRelevant: jest.fn().mockResolvedValue(agreeingHits),
      };
      const config = { get: jest.fn().mockReturnValue(mode) };
      const usecase = new IntentClassifierUsecase(
        modelRouter,
        dispatchers,
        episodic as never,
        undefined,
        config as never,
      );
      return { usecase, modelRouter, episodic };
    };

    it('on: 확신하면 LLM 을 부르지 않고 그 담당을 돌려준다', async () => {
      const { usecase, modelRouter } = build('on');

      const result = await usecase.classify({ text: 'PR 리뷰해줘' });

      expect(modelRouter.route).not.toHaveBeenCalled();
      expect(result.agentType).toBe(AgentType.CODE_REVIEWER);
      expect(result.memoryShortcut).toEqual({
        agentType: AgentType.CODE_REVIEWER,
        similarity: 0.98,
        applied: true,
      });
    });

    it('on 이어도 직전 대화가 있으면 LLM 으로 분류한다', async () => {
      const { usecase, modelRouter } = build('on');

      const result = await usecase.classify({
        text: '응 해줘',
        priorTurns: [
          {
            role: 'user',
            text: '리뷰 해줄래?',
            agentType: null,
            agentRunId: null,
          },
        ] as never,
      });

      expect(modelRouter.route).toHaveBeenCalledTimes(1);
      expect(result.memoryShortcut).toBeUndefined();
    });

    // DM 의 24시간 내역은 맥락으로만 쓰고, 첫 턴 여부는 라우터가 넘긴 값으로 정한다.
    it('priorTurns 가 있어도 첫 턴이라고 넘기면 단축 판정을 한다', async () => {
      const { usecase, modelRouter } = build('on');

      const result = await usecase.classify({
        text: 'PR 리뷰해줘',
        priorTurns: [
          {
            role: 'user',
            text: '어제 한 얘기',
            agentType: null,
            agentRunId: null,
          },
        ] as never,
        isFirstTurn: true,
      });

      expect(modelRouter.route).not.toHaveBeenCalled();
      expect(result.memoryShortcut?.applied).toBe(true);
    });

    it('shadow: LLM 결과로 정하고 판정만 applied=false 로 싣는다', async () => {
      const { usecase, modelRouter } = build('shadow');

      const result = await usecase.classify({ text: 'PR 리뷰해줘' });

      expect(modelRouter.route).toHaveBeenCalledTimes(1);
      expect(result.agentType).toBe(AgentType.PM);
      expect(result.memoryShortcut).toEqual({
        agentType: AgentType.CODE_REVIEWER,
        similarity: 0.98,
        applied: false,
      });
    });

    it.each([undefined, 'off', 'typo'])(
      '%s: 단축 판정을 하지 않는다',
      async (mode) => {
        const { usecase, modelRouter } = build(mode);

        const result = await usecase.classify({ text: 'PR 리뷰해줘' });

        expect(modelRouter.route).toHaveBeenCalledTimes(1);
        expect(result.memoryShortcut).toBeUndefined();
      },
    );

    it('예시 저장은 정규화한 문장을 query 접두어로 routing_example 에 남긴다', async () => {
      const { usecase, episodic } = build('off');

      await usecase.rememberRoutingExample({
        text: '<@U0AULUXLF9B>  PR\n리뷰해줘',
        agentType: AgentType.CODE_REVIEWER,
        agentRunId: 77,
      });

      expect(episodic.record).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'routing_example',
          agentRunId: 77,
          agentType: AgentType.CODE_REVIEWER,
          content: 'PR 리뷰해줘',
          embedAs: 'query',
          // 반복 요청의 사본이 검색 상한을 채워 다른 문장을 밀어내지 않게.
          skipIfSameContent: true,
        }),
      );
    });
  });
});
