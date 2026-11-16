import { ProposalSkipReason, ProposalTarget } from './humanize-research.type';
import {
  constrainEnforcementGaps,
  constrainResearchProposals,
  InvalidHumanizeResearchResponseError,
  parseResearchOutput,
  quickRuleIds,
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

it('상한이 찬 뒤의 제안에는 게이트를 부르지 않는다', () => {
  const gate = jest.fn(() => null);
  const proposals = Array.from({ length: 20 }, () => proposal);
  const result = constrainResearchProposals({
    proposals,
    includedIds: new Set(['blog:post']),
    gate,
  });
  expect(gate).toHaveBeenCalledTimes(result.proposals.length);
  expect(result.skipped[0].reason).toBe(ProposalSkipReason.OVER_LIMIT);
});

it('근거가 비거나 입력에 없는 id 를 가리키는 gap 은 버린다', () => {
  const gaps = [
    { ruleId: 'A', evidence: [] },
    { ruleId: 'B', evidence: ['included', 'absent'] },
    { ruleId: 'C', evidence: ['included'] },
  ];
  const result = constrainEnforcementGaps({
    gaps,
    includedIds: new Set(['included']),
    knownRuleIds: new Set(['A', 'B', 'C']),
  });
  expect(result).toEqual([{ ruleId: 'C', evidence: ['included'] }]);
});

it('정본·연결표에 없는 규칙 id 를 가리키는 gap 은 버린다', () => {
  const result = constrainEnforcementGaps({
    gaps: [
      { ruleId: 'C-11', evidence: ['included'] },
      { ruleId: 'Z-99', evidence: ['included'] },
    ],
    includedIds: new Set(['included']),
    knownRuleIds: new Set(['C-11']),
  });
  expect(result).toEqual([{ ruleId: 'C-11', evidence: ['included'] }]);
});

it('quickRuleIds 는 표 행의 규칙 id 만 뽑는다', () => {
  const ids = quickRuleIds(
    '| A-1 | 규칙 | S2 |\n본문 | B-2 |\n| C-11 | 쉼표 | S2 |',
  );
  expect(ids).toEqual(['A-1', 'C-11']);
});
