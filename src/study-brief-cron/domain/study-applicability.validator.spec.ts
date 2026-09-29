import { KeywordCandidate } from '../../code-graph/domain/keyword-candidate.type';
import { RawApplicabilityOutput } from './study-applicability.type';
import {
  notApplicableWithoutModel,
  validateApplicability,
} from './study-applicability.validator';

const candidate = (id: string, name: string): KeywordCandidate => ({
  id,
  name,
  score: 10,
  filePath: `src/${name}.ts`,
  kind: 'function',
  startLine: 3,
  endLine: 9,
  source: '',
});
const proposal = { title: 't', problem: 'p', change: 'c', verify: 'v' };
const raw = (
  over: Partial<RawApplicabilityOutput>,
): RawApplicabilityOutput => ({
  verdict: 'APPLY',
  reason: 'r',
  citations: [{ chunkId: 'c1', why: 'w' }],
  proposal,
  ...over,
});
const candidates = [candidate('c1', 'buildClaudeArgs')];

describe('validateApplicability', () => {
  it('정상 APPLY 는 인용을 파일:라인으로 풀어 유지한다', () => {
    const result = validateApplicability(raw({}), candidates);
    expect(result).toMatchObject({
      verdict: 'APPLY',
      rawVerdict: 'APPLY',
      downgradeReason: null,
      proposal,
      candidateCount: 1,
      citations: [
        {
          filePath: 'src/buildClaudeArgs.ts',
          startLine: 3,
          endLine: 9,
          name: 'buildClaudeArgs',
          why: 'w',
        },
      ],
      droppedCitations: [],
    });
  });

  it('후보 밖 인용은 제거하고, 남는 인용이 없으면 REFERENCE 로 강등한다', () => {
    const result = validateApplicability(
      raw({ citations: [{ chunkId: 'c9', why: 'w' }] }),
      candidates,
    );
    expect(result).toMatchObject({
      verdict: 'REFERENCE',
      rawVerdict: 'APPLY',
      downgradeReason: 'NO_VALID_CITATION',
      proposal: null,
      citations: [],
      droppedCitations: [{ chunkId: 'c9', reason: 'NOT_IN_CANDIDATES' }],
    });
  });

  it('APPLY 인데 proposal 이 null 이면 NO_PROPOSAL 로 강등한다', () => {
    expect(
      validateApplicability(raw({ proposal: null }), candidates),
    ).toMatchObject({ verdict: 'REFERENCE', downgradeReason: 'NO_PROPOSAL' });
  });

  it('REFERENCE 판정의 proposal 은 버린다', () => {
    expect(
      validateApplicability(raw({ verdict: 'REFERENCE' }), candidates).proposal,
    ).toBeNull();
  });
});

describe('notApplicableWithoutModel', () => {
  it('모델 없이 마감한 판정은 rawVerdict 가 null', () => {
    expect(notApplicableWithoutModel('키워드 없음', 0)).toMatchObject({
      verdict: 'NOT_APPLICABLE',
      rawVerdict: null,
      reason: '키워드 없음',
      candidateCount: 0,
    });
  });
});
