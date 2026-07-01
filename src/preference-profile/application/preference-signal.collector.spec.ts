import { PreferenceSignalCollector } from './preference-signal.collector';
import { PreferenceSignal } from '../domain/preference-signal.type';

const source = (name: string, signals: PreferenceSignal[]) => ({
  name,
  fetch: jest.fn().mockResolvedValue(signals),
});

describe('PreferenceSignalCollector.collect', () => {
  it('여러 소스를 합치고 cap 으로 자른다', async () => {
    const a = source('a', [
      { source: 'proposal_decision', evidenceRef: 'p1', observedText: 't1' },
      { source: 'proposal_decision', evidenceRef: 'p2', observedText: 't2' },
    ]);
    const b = source('b', [
      { source: 'reaction', evidenceRef: 'r1', observedText: 't3' },
    ]);
    const collector = new PreferenceSignalCollector([a, b] as never);
    const signals = await collector.collect('U1', Date.now() - 1000, 2);
    expect(signals).toHaveLength(2);
  });

  it('한 소스가 throw 해도 나머지 소스는 수집(best-effort)', async () => {
    const bad = { name: 'bad', fetch: jest.fn().mockRejectedValue(new Error('x')) };
    const good = source('good', [
      { source: 'reaction', evidenceRef: 'r', observedText: 't' },
    ]);
    const collector = new PreferenceSignalCollector([bad, good] as never);
    const signals = await collector.collect('U1', 0, 10);
    expect(signals).toHaveLength(1);
  });
});
