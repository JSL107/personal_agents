import { ConfigService } from '@nestjs/config';

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

describe('JevSubconsciousGate', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('변화가 없으면 Jev API를 호출하지 않는다', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    const gate = new JevSubconsciousGate(
      makeConfig({ TYPESAFE_API_KEY: 'test-key' }),
    );

    await expect(gate.evaluate([])).resolves.toEqual({
      decisions: [],
      confidentDecisions: [],
      fallbackChanges: [],
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
    const gate = new JevSubconsciousGate(
      makeConfig({ TYPESAFE_API_KEY: 'test-key' }),
    );

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

  it('API 키가 없으면 호출하지 않고 실패한다', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    const gate = new JevSubconsciousGate(makeConfig());

    await expect(gate.evaluate([makeChange('pr-1')])).rejects.toThrow(
      'TYPESAFE_API_KEY is not configured',
    );
    expect(fetchMock).not.toHaveBeenCalled();
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
    const gate = new JevSubconsciousGate(
      makeConfig({ TYPESAFE_API_KEY: 'test-key' }),
    );

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
