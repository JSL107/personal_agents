import { ProposalSkipReason } from './humanize-research.type';
import {
  constrainResearchProposals,
  InvalidHumanizeResearchResponseError,
  parseResearchOutput,
} from './humanize-research-output';

const proposal = {
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
    expect(result.proposals).toEqual([proposal]);
    expect(result.skipped.map((entry) => entry.reason)).toEqual([
      ProposalSkipReason.INVALID_SHAPE,
      ProposalSkipReason.NO_EVIDENCE,
      ProposalSkipReason.OVER_LIMIT,
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
