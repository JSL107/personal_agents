import { ProposalSkipReason, ProposalTarget } from './humanize-research.type';
import {
  constrainResearchProposals,
  InvalidHumanizeResearchResponseError,
  parseResearchOutput,
} from './humanize-research-output';

const proposal = {
  target: ProposalTarget.CANON,
  file: 'references/quick-rules.md',
  oldString: 'old',
  newString: 'new',
  targetMetric: 'translationese',
  rationale: '반복 신호',
  evidence: ['blog:post'],
};

describe('humanize research model output', () => {
  it('빈 배열은 정상 결과이며 객체가 아니거나 proposals가 없으면 실패한다', () => {
    expect(
      parseResearchOutput('{"proposals":[],"injectionNotices":[]}'),
    ).toEqual({
      proposals: [],
      enforcementGaps: [],
      injectionNotices: [],
    });
    expect(() => parseResearchOutput('[]')).toThrow(
      InvalidHumanizeResearchResponseError,
    );
    expect(() => parseResearchOutput('{"proposals":{}}')).toThrow(
      InvalidHumanizeResearchResponseError,
    );
  });

  it('형태 실패, 근거 접두 일치, 상한 초과를 각각 사유 코드로 남긴다', () => {
    const result = constrainResearchProposals({
      proposals: [
        { ...proposal, oldString: '' },
        { ...proposal, evidence: ['blog:post-extra'] },
        proposal,
        proposal,
      ],
      includedIds: new Set(['blog:post']),
    });
    expect(result.proposals).toEqual([proposal, proposal]);
    expect(result.skipped.map((entry) => entry.reason)).toEqual([
      ProposalSkipReason.INVALID_SHAPE,
      ProposalSkipReason.NO_EVIDENCE,
    ]);
  });

  it('newString 이 빈 문자열인 삭제 제안은 통과시키고, 문자열이 아니면 막는다', () => {
    const deletion = { ...proposal, newString: '' };
    const result = constrainResearchProposals({
      proposals: [deletion, { ...proposal, newString: null }],
      includedIds: new Set(['blog:post']),
    });
    expect(result.proposals).toEqual([deletion]);
    expect(result.skipped.map((entry) => entry.reason)).toEqual([
      ProposalSkipReason.INVALID_SHAPE,
    ]);
  });
});

describe('새 제안 형식', () => {
  it('target 없는 제안은 INVALID_SHAPE', () => {
    const result = constrainResearchProposals({
      proposals: [{ ...proposal, target: undefined }],
      includedIds: new Set(['blog:post']),
    });
    expect(result.skipped[0].reason).toBe(ProposalSkipReason.INVALID_SHAPE);
  });
  it('enforcementGaps 는 문자열 ruleId·근거 배열만 통과', () => {
    const parsed = parseResearchOutput(
      JSON.stringify({
        proposals: [],
        enforcementGaps: [
          { ruleId: 'A-1', evidence: ['a'] },
          { ruleId: 1, evidence: [] },
          { ruleId: 'B', evidence: [1] },
        ],
      }),
    );
    expect(parsed.enforcementGaps).toEqual([
      { ruleId: 'A-1', evidence: ['a'] },
    ]);
  });
  it('enforcementGaps 가 없으면 빈 배열', () => {
    expect(parseResearchOutput('{"proposals":[]}').enforcementGaps).toEqual([]);
  });
});
