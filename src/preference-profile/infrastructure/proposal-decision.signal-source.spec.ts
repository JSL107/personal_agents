import { PreferenceProposalRecord } from '../domain/port/preference-proposal.repository.port';
import { ProposalDecisionSignalSource } from './proposal-decision.signal-source';

const makeRecord = (
  overrides: Partial<PreferenceProposalRecord> = {},
): PreferenceProposalRecord => ({
  id: 1,
  ownerUserId: 'U1',
  baseVersion: 0,
  diff: {},
  rationale: '기본 근거',
  status: 'APPROVED',
  createdAt: new Date(),
  ...overrides,
});

describe('ProposalDecisionSignalSource', () => {
  it('recentDecisions 결과를 PreferenceSignal 배열로 매핑한다', async () => {
    const records = [
      makeRecord({ id: 9, status: 'APPROVED', rationale: '명확한 근거' }),
      makeRecord({ id: 42, status: 'REJECTED', rationale: '불명확' }),
    ];
    const repository = {
      recentDecisions: jest.fn().mockResolvedValue(records),
      createPending: jest.fn(),
      findById: jest.fn(),
      markResolved: jest.fn(),
      countPendingSince: jest.fn(),
    };
    const source = new ProposalDecisionSignalSource(repository as never);
    const signals = await source.fetch('U1', Date.now() - 86400_000);

    expect(signals).toHaveLength(2);
    expect(signals[0]).toEqual({
      source: 'proposal_decision',
      evidenceRef: 'preferenceProposal:9',
      observedText: '[APPROVED] 명확한 근거',
    });
    expect(signals[1]).toEqual({
      source: 'proposal_decision',
      evidenceRef: 'preferenceProposal:42',
      observedText: '[REJECTED] 불명확',
    });
  });

  it('recentDecisions 가 빈 배열이면 빈 신호를 반환한다', async () => {
    const repository = {
      recentDecisions: jest.fn().mockResolvedValue([]),
      createPending: jest.fn(),
      findById: jest.fn(),
      markResolved: jest.fn(),
      countPendingSince: jest.fn(),
    };
    const source = new ProposalDecisionSignalSource(repository as never);
    const signals = await source.fetch('U1', 0);
    expect(signals).toEqual([]);
  });
});
