import { ConfigService } from '@nestjs/config';

import { AgentType } from '../../model-router/domain/model-router.type';
import { SubconsciousGateShadowRepository } from '../domain/port/subconscious-gate-shadow.repository.port';
import { GateDecision, RedactedChange } from '../domain/subconscious.type';
import { HybridSubconsciousGate } from './hybrid-subconscious-gate';
import { JevEvaluation, JevSubconsciousGate } from './jev-subconscious-gate';
import { LlmSubconsciousGate } from './llm-subconscious-gate';

const change: RedactedChange = {
  sourceId: 'github:pr',
  kind: 'added',
  key: 'pr-1',
  summary: '변화',
};

const legacyDecision: GateDecision = {
  changeKey: 'pr-1',
  promote: false,
  reason: '기존 LLM',
};

const evaluation: JevEvaluation = {
  decisions: [legacyDecision],
  confidentDecisions: [
    {
      changeKey: 'pr-1',
      promote: true,
      reason: 'Jev',
      suggestedAgentType: AgentType.CODE_REVIEWER,
    },
  ],
  fallbackChanges: [],
  scores: [
    {
      changeKey: 'pr-1',
      promoteProbability: 0.99,
      agentChoice: 'NONE',
      agentConfidence: 0.42,
    },
  ],
  model: 'jev-1.13.0',
};

const makeGate = (
  mode: string,
  jev: Partial<JevSubconsciousGate>,
  legacy: Partial<LlmSubconsciousGate>,
  shadowRepository: SubconsciousGateShadowRepository = {
    recordMany: jest.fn().mockResolvedValue(undefined),
  },
) =>
  new HybridSubconsciousGate(
    {
      get: jest.fn((key: string) =>
        key === 'SUBCONSCIOUS_GATE_MODE' ? mode : undefined,
      ),
    } as unknown as ConfigService,
    jev as JevSubconsciousGate,
    legacy as LlmSubconsciousGate,
    shadowRepository,
  );

describe('HybridSubconsciousGate', () => {
  it('legacy 모드는 기존 LLM만 호출한다', async () => {
    const legacy = { judge: jest.fn().mockResolvedValue([legacyDecision]) };
    const jev = { evaluate: jest.fn() };
    const gate = makeGate('legacy', jev, legacy);

    await expect(gate.judge([change])).resolves.toEqual([legacyDecision]);
    expect(legacy.judge).toHaveBeenCalledWith([change]);
    expect(jev.evaluate).not.toHaveBeenCalled();
  });

  it('shadow 모드는 실제 결과를 기존 LLM에서만 가져온다', async () => {
    const legacy = { judge: jest.fn().mockResolvedValue([legacyDecision]) };
    const jev = { evaluate: jest.fn().mockResolvedValue(evaluation) };
    const gate = makeGate('shadow', jev, legacy);

    await expect(gate.judge([change])).resolves.toEqual([legacyDecision]);
    expect(jev.evaluate).toHaveBeenCalledWith([change]);
  });

  it('hybrid 모드는 확신 높은 Jev 결과와 fallback LLM 결과를 합친다', async () => {
    const legacy = { judge: jest.fn().mockResolvedValue([legacyDecision]) };
    const jev = { evaluate: jest.fn().mockResolvedValue(evaluation) };
    const gate = makeGate('hybrid', jev, legacy);

    await expect(gate.judge([change])).resolves.toEqual(
      evaluation.confidentDecisions,
    );
    expect(legacy.judge).not.toHaveBeenCalled();
  });

  it('hybrid 모드에서 Jev가 실패하면 전체를 기존 LLM으로 fallback한다', async () => {
    const legacy = { judge: jest.fn().mockResolvedValue([legacyDecision]) };
    const jev = {
      evaluate: jest.fn().mockRejectedValue(new Error('Jev unavailable')),
    };
    const gate = makeGate('hybrid', jev, legacy);

    await expect(gate.judge([change])).resolves.toEqual([legacyDecision]);
    expect(legacy.judge).toHaveBeenCalledWith([change]);
  });

  it('shadow 모드는 변경마다 shadow 점수와 legacy 판정을 한 행으로 남긴다', async () => {
    const legacy = { judge: jest.fn().mockResolvedValue([legacyDecision]) };
    const jev = { evaluate: jest.fn().mockResolvedValue(evaluation) };
    const shadowRepository = {
      recordMany: jest.fn().mockResolvedValue(undefined),
    };
    const gate = makeGate('shadow', jev, legacy, shadowRepository);

    await gate.judge([change]);

    expect(shadowRepository.recordMany).toHaveBeenCalledWith([
      {
        changeKey: 'pr-1',
        sourceId: 'github:pr',
        kind: 'added',
        summary: '변화',
        shadowModel: 'jev-1.13.0',
        promoteProbability: 0.99,
        agentChoice: 'NONE',
        agentConfidence: 0.42,
        legacyPromote: false,
        legacyAgent: null,
        error: null,
      },
    ]);
  });

  it('shadow 호출이 실패해도 error 행을 남기고 legacy 결과를 돌려준다', async () => {
    const legacy = { judge: jest.fn().mockResolvedValue([legacyDecision]) };
    const jev = {
      evaluate: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
      model: 'kev-latest',
    };
    const shadowRepository = {
      recordMany: jest.fn().mockResolvedValue(undefined),
    };
    const gate = makeGate('shadow', jev, legacy, shadowRepository);

    await expect(gate.judge([change])).resolves.toEqual([legacyDecision]);
    expect(shadowRepository.recordMany).toHaveBeenCalledWith([
      expect.objectContaining({
        shadowModel: 'kev-latest',
        promoteProbability: null,
        agentChoice: null,
        agentConfidence: null,
        legacyPromote: false,
        error: 'connect ECONNREFUSED',
      }),
    ]);
  });

  it('shadow 저장이 실패해도 legacy 결과를 돌려준다', async () => {
    const legacy = { judge: jest.fn().mockResolvedValue([legacyDecision]) };
    const jev = { evaluate: jest.fn().mockResolvedValue(evaluation) };
    const shadowRepository = {
      recordMany: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const gate = makeGate('shadow', jev, legacy, shadowRepository);

    await expect(gate.judge([change])).resolves.toEqual([legacyDecision]);
  });

  it('legacy 실패는 shadow 를 저장한 뒤 그대로 던진다', async () => {
    const legacy = {
      judge: jest.fn().mockRejectedValue(new Error('llm down')),
    };
    const jev = { evaluate: jest.fn().mockResolvedValue(evaluation) };
    const shadowRepository = {
      recordMany: jest.fn().mockResolvedValue(undefined),
    };
    const gate = makeGate('shadow', jev, legacy, shadowRepository);

    await expect(gate.judge([change])).rejects.toThrow('llm down');
    expect(shadowRepository.recordMany).toHaveBeenCalledWith([
      expect.objectContaining({
        legacyPromote: null,
        promoteProbability: 0.99,
      }),
    ]);
  });

  it('legacy·hybrid 모드는 shadow 를 저장하지 않는다', async () => {
    for (const mode of ['legacy', 'hybrid']) {
      const legacy = { judge: jest.fn().mockResolvedValue([legacyDecision]) };
      const jev = { evaluate: jest.fn().mockResolvedValue(evaluation) };
      const shadowRepository = { recordMany: jest.fn() };
      await makeGate(mode, jev, legacy, shadowRepository).judge([change]);
      expect(shadowRepository.recordMany).not.toHaveBeenCalled();
    }
  });
});
