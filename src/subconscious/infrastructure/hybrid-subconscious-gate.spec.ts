import { ConfigService } from '@nestjs/config';

import { AgentType } from '../../model-router/domain/model-router.type';
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
  model: 'jev-1.13.0',
};

const makeGate = (
  mode: string,
  jev: Partial<JevSubconsciousGate>,
  legacy: Partial<LlmSubconsciousGate>,
) =>
  new HybridSubconsciousGate(
    {
      get: jest.fn((key: string) =>
        key === 'SUBCONSCIOUS_GATE_MODE' ? mode : undefined,
      ),
    } as unknown as ConfigService,
    jev as JevSubconsciousGate,
    legacy as LlmSubconsciousGate,
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
});
