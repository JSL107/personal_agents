import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { AgentType } from '../../model-router/domain/model-router.type';
import { RedactedChange } from '../domain/subconscious.type';
import { JevSubconsciousGate } from './jev-subconscious-gate';

const makeChange = (key: string): RedactedChange => ({
  sourceId: 'github:pr',
  kind: 'added',
  key,
  summary: `변화 ${key}`,
});

const makeConfig = (values: Record<string, string | undefined> = {}) =>
  ({ get: jest.fn((key: string) => values[key]) }) as unknown as ConfigService;

const makeAgentRunService = () =>
  ({
    execute: jest.fn(async (input) => {
      const execution = await input.run({
        agentRunId: 1,
        updateInputSnapshot: jest.fn(),
      });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 1,
      };
    }),
  }) as unknown as AgentRunService;

const makeGate = (values: Record<string, string | undefined> = {}) =>
  new JevSubconsciousGate(makeConfig(values), makeAgentRunService());

describe('JevSubconsciousGate', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('변화가 없으면 Jev API를 호출하지 않는다', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    const gate = makeGate({ TYPESAFE_API_KEY: 'test-key' });

    await expect(gate.evaluate([])).resolves.toEqual({
      decisions: [],
      confidentDecisions: [],
      fallbackChanges: [],
      scores: [],
      model: 'jev-1.13.0',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('확신 높은 promote 결과만 confidentDecisions로 분리한다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: {
          promote_0: { type: 'noul', noul: 0.99 },
          agent_0: {
            type: 'choice',
            choice: AgentType.CODE_REVIEWER,
            confidence: 0.98,
          },
          promote_1: { type: 'noul', noul: 0.8 },
          agent_1: {
            type: 'choice',
            choice: AgentType.PM,
            confidence: 0.9,
          },
        },
      }),
    }) as typeof fetch;
    const gate = makeGate({ TYPESAFE_API_KEY: 'test-key' });

    const result = await gate.evaluate([
      makeChange('pr-1'),
      makeChange('pr-2'),
    ]);

    expect(result.confidentDecisions).toEqual([
      expect.objectContaining({
        changeKey: 'pr-1',
        promote: true,
        suggestedAgentType: AgentType.CODE_REVIEWER,
      }),
    ]);
    expect(result.fallbackChanges).toEqual([makeChange('pr-2')]);
  });

  it.each([
    {
      name: 'noul answer type 불일치',
      promote: { type: 'choice', noul: 0.99 },
      agent: {
        type: 'choice',
        choice: AgentType.CODE_REVIEWER,
        confidence: 0.99,
      },
    },
    {
      name: 'promote 확률 범위 초과',
      promote: { type: 'noul', noul: 1.01 },
      agent: {
        type: 'choice',
        choice: AgentType.CODE_REVIEWER,
        confidence: 0.99,
      },
    },
    {
      name: 'choice answer type 불일치',
      promote: { type: 'noul', noul: 0.99 },
      agent: {
        type: 'noul',
        choice: AgentType.CODE_REVIEWER,
        confidence: 0.99,
      },
    },
    {
      name: 'confidence 범위 초과',
      promote: { type: 'noul', noul: 0.99 },
      agent: {
        type: 'choice',
        choice: AgentType.CODE_REVIEWER,
        confidence: 1.01,
      },
    },
  ])(
    '$name 응답은 자동 승격하지 않고 fallback한다',
    async ({ promote, agent }) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'jev-1.13.0',
          answers: { promote_0: promote, agent_0: agent },
        }),
      }) as typeof fetch;
      const gate = makeGate({ TYPESAFE_API_KEY: 'test-key' });

      await expect(gate.evaluate([makeChange('pr-1')])).resolves.toEqual(
        expect.objectContaining({
          confidentDecisions: [],
          fallbackChanges: [makeChange('pr-1')],
        }),
      );
    },
  );

  it('요청한 모델과 다른 응답은 신뢰하지 않는다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'jev-older',
        answers: {},
      }),
    }) as typeof fetch;
    const gate = makeGate({ TYPESAFE_API_KEY: 'test-key' });

    await expect(gate.evaluate([makeChange('pr-1')])).rejects.toThrow(
      'Jev response model did not match request',
    );
  });

  it('Jev 판정을 SUBCONSCIOUS_GATE AgentRun으로 기록한다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: {
          promote_0: { type: 'noul', noul: 0.99 },
          agent_0: {
            type: 'choice',
            choice: AgentType.CODE_REVIEWER,
            confidence: 0.99,
          },
        },
      }),
    }) as typeof fetch;
    const execute = jest.fn(
      async (input: {
        run: () => Promise<{
          result: unknown;
          modelUsed: string;
          output: unknown;
        }>;
      }) => {
        const execution = await input.run();
        return { ...execution, agentRunId: 1 };
      },
    );
    const gate = Reflect.construct(JevSubconsciousGate, [
      makeConfig({ TYPESAFE_API_KEY: 'test-key' }),
      { execute } as unknown as Partial<AgentRunService>,
    ]) as JevSubconsciousGate;

    await gate.evaluate([makeChange('pr-1')]);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.SUBCONSCIOUS_GATE,
        inputSnapshot: expect.objectContaining({ changeCount: 1 }),
      }),
    );
  });

  it('API 키가 없으면 호출하지 않고 실패한다', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    const gate = makeGate();

    await expect(gate.evaluate([makeChange('pr-1')])).rejects.toThrow(
      'TYPESAFE_API_KEY is not configured',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('로컬 URL에서는 API 키 없이 호출하고 Authorization을 생략한다', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'kev-latest', answers: {} }),
    });
    global.fetch = fetchMock as typeof fetch;
    const gate = makeGate({
      SUBCONSCIOUS_JEV_API_URL: 'http://127.0.0.1:8009/v1/systemone',
      SUBCONSCIOUS_JEV_MODEL: 'kev-latest',
    });

    const result = await gate.evaluate([makeChange('pr-1')]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8009/v1/systemone',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(result.scores).toEqual([
      {
        changeKey: 'pr-1',
        promoteProbability: null,
        agentChoice: null,
        agentConfidence: null,
      },
    ]);
  });

  it('로컬 URL 에는 TypeSafe 키가 설정돼 있어도 보내지 않는다', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'kev-4b', answers: {} }),
    });
    global.fetch = fetchMock as typeof fetch;

    await makeGate({
      SUBCONSCIOUS_JEV_API_URL: 'http://localhost:8009/v1/systemone',
      SUBCONSCIOUS_JEV_MODEL: 'kev-4b',
      TYPESAFE_API_KEY: 'secret-key',
    }).evaluate([makeChange('pr-1')]);

    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('원격 URL 이 https 가 아니면 키를 평문으로 보내지 않고 실패한다', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;

    await expect(
      makeGate({
        SUBCONSCIOUS_JEV_API_URL: 'http://jev.example.com/v1/systemone',
        TYPESAFE_API_KEY: 'secret-key',
      }).evaluate([makeChange('pr-1')]),
    ).rejects.toThrow('https');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('NONE 선택의 원값과 유효 점수를 보존한다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: {
          promote_0: { type: 'noul', noul: 0.7 },
          agent_0: { type: 'choice', choice: 'NONE', confidence: 0.8 },
        },
      }),
    }) as typeof fetch;

    const result = await makeGate({ TYPESAFE_API_KEY: 'test-key' }).evaluate([
      makeChange('pr-1'),
    ]);
    expect(result.scores).toEqual([
      {
        changeKey: 'pr-1',
        promoteProbability: 0.7,
        agentChoice: 'NONE',
        agentConfidence: 0.8,
      },
    ]);
    expect(result.fallbackChanges).toEqual([makeChange('pr-1')]);
  });

  it('API 요청은 개인정보 제거가 끝난 변화와 고정 모델을 사용한다', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: {
          promote_0: { type: 'noul', noul: 0.1 },
          agent_0: {
            type: 'choice',
            choice: 'NONE',
            confidence: 0.99,
          },
        },
      }),
    });
    global.fetch = fetchMock as typeof fetch;
    const gate = makeGate({ TYPESAFE_API_KEY: 'test-key' });

    await gate.evaluate([makeChange('pr-1')]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.typesafe.ai/v1/systemone',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
        body: expect.stringContaining('jev-1.13.0'),
      }),
    );
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      state: Array<{ summary: string }>;
    };
    expect(request.state[0].summary).toBe('변화 pr-1');
  });
});
