import { Logger } from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
import { GateDecision, StateSnapshot } from '../domain/subconscious.type';
import { SubconsciousEngine } from './subconscious.engine';

const makeSnapshot = (sourceId: string, tag: string): StateSnapshot => ({
  sourceId,
  contentHash: tag,
  items: [
    { key: `${sourceId}:item-1`, fingerprint: tag, summary: `summary-${tag}` },
  ],
});

describe('SubconsciousEngine', () => {
  let fakeBaselineRepository: {
    findBySource: jest.Mock;
    upsert: jest.Mock;
  };
  let fakeGate: { judge: jest.Mock };
  let fakeBudget: { tryConsume: jest.Mock };
  let fakeProposalEmitter: { emit: jest.Mock };
  let engine: SubconsciousEngine;

  const NOW = 1_000_000;
  const OWNER = 'U_OWNER';

  beforeEach(() => {
    fakeBaselineRepository = {
      findBySource: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    fakeGate = { judge: jest.fn().mockResolvedValue([]) };
    fakeBudget = { tryConsume: jest.fn().mockResolvedValue(true) };
    fakeProposalEmitter = { emit: jest.fn().mockResolvedValue(undefined) };

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  const buildEngine = (sources: { id: string; fetchSnapshot: jest.Mock }[]) =>
    new SubconsciousEngine(
      sources as never,
      fakeGate as never,
      fakeBudget as never,
      fakeBaselineRepository as never,
      fakeProposalEmitter as never,
    );

  it('케이스 1: 모든 소스 무변화 → gate.judge 0회, 제안 0건, baseline 갱신', async () => {
    const snapshot = makeSnapshot('github', 'hash-A');
    const source = {
      id: 'github',
      fetchSnapshot: jest.fn().mockResolvedValue(snapshot),
    };
    // baseline returns same hash → diff returns []
    fakeBaselineRepository.findBySource.mockResolvedValue(snapshot);

    engine = buildEngine([source]);
    await engine.runTick(OWNER, NOW);

    expect(fakeGate.judge).not.toHaveBeenCalled();
    expect(fakeProposalEmitter.emit).not.toHaveBeenCalled();
    // baseline still upserted even when no change
    expect(fakeBaselineRepository.upsert).toHaveBeenCalledTimes(1);
  });

  it('케이스 2: 변화 있고 promote+suggestedAgentType → emit 1회, budget 1회 소비', async () => {
    const prevSnapshot = makeSnapshot('github', 'hash-OLD');
    const currSnapshot = makeSnapshot('github', 'hash-NEW');
    const source = {
      id: 'github',
      fetchSnapshot: jest.fn().mockResolvedValue(currSnapshot),
    };
    fakeBaselineRepository.findBySource.mockResolvedValue(prevSnapshot);

    const decision: GateDecision = {
      changeKey: 'github:item-1',
      promote: true,
      reason: 'new PR',
      suggestedAgentType: AgentType.CODE_REVIEWER,
      proposalText: 'PR 리뷰할까요?',
    };
    fakeGate.judge.mockResolvedValue([decision]);

    engine = buildEngine([source]);
    await engine.runTick(OWNER, NOW);

    expect(fakeGate.judge).toHaveBeenCalledTimes(1);
    expect(fakeBudget.tryConsume).toHaveBeenCalledWith(OWNER, NOW);
    expect(fakeProposalEmitter.emit).toHaveBeenCalledTimes(1);
    expect(fakeProposalEmitter.emit).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: OWNER, decision }),
    );
  });

  it('케이스 3: budget.tryConsume=false → emit 0건', async () => {
    const prevSnapshot = makeSnapshot('github', 'hash-OLD');
    const currSnapshot = makeSnapshot('github', 'hash-NEW');
    const source = {
      id: 'github',
      fetchSnapshot: jest.fn().mockResolvedValue(currSnapshot),
    };
    fakeBaselineRepository.findBySource.mockResolvedValue(prevSnapshot);

    const decision: GateDecision = {
      changeKey: 'github:item-1',
      promote: true,
      reason: 'new PR',
      suggestedAgentType: AgentType.CODE_REVIEWER,
    };
    fakeGate.judge.mockResolvedValue([decision]);
    fakeBudget.tryConsume.mockResolvedValue(false);

    engine = buildEngine([source]);
    await engine.runTick(OWNER, NOW);

    expect(fakeBudget.tryConsume).toHaveBeenCalledTimes(1);
    expect(fakeProposalEmitter.emit).not.toHaveBeenCalled();
  });

  it('케이스 4: 한 소스 fetchSnapshot throw → 다른 소스 계속, 실패 소스 baseline 미갱신', async () => {
    const goodSnapshot = makeSnapshot('notion', 'hash-N');
    const goodSource = {
      id: 'notion',
      fetchSnapshot: jest.fn().mockResolvedValue(goodSnapshot),
    };
    const badSource = {
      id: 'github',
      fetchSnapshot: jest.fn().mockRejectedValue(new Error('network error')),
    };
    fakeBaselineRepository.findBySource.mockResolvedValue(null);
    fakeGate.judge.mockResolvedValue([]);

    engine = buildEngine([badSource, goodSource]);
    await engine.runTick(OWNER, NOW);

    // good source baseline was upserted, bad source was not
    expect(fakeBaselineRepository.upsert).toHaveBeenCalledTimes(1);
    expect(fakeBaselineRepository.upsert).toHaveBeenCalledWith(
      OWNER,
      'notion',
      goodSnapshot,
    );
  });

  it('케이스 5: promote=true 이지만 suggestedAgentType 없음 → drop, emit 0건', async () => {
    const prevSnapshot = makeSnapshot('github', 'hash-OLD');
    const currSnapshot = makeSnapshot('github', 'hash-NEW');
    const source = {
      id: 'github',
      fetchSnapshot: jest.fn().mockResolvedValue(currSnapshot),
    };
    fakeBaselineRepository.findBySource.mockResolvedValue(prevSnapshot);

    const decision: GateDecision = {
      changeKey: 'github:item-1',
      promote: true,
      reason: 'something changed',
      // suggestedAgentType intentionally omitted
    };
    fakeGate.judge.mockResolvedValue([decision]);

    engine = buildEngine([source]);
    await engine.runTick(OWNER, NOW);

    expect(fakeGate.judge).toHaveBeenCalledTimes(1);
    expect(fakeBudget.tryConsume).not.toHaveBeenCalled();
    expect(fakeProposalEmitter.emit).not.toHaveBeenCalled();
  });
});
