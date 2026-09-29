import { KeywordCandidate } from '../../code-graph/domain/keyword-candidate.type';
import {
  buildStudyApplicabilityPrompt,
  MAX_CANDIDATE_CHARS,
  MAX_CHUNK_LINES,
} from './study-applicability.prompt';

const candidate = (id: string, lines: number): KeywordCandidate => ({
  id,
  name: `fn${id}`,
  score: 10,
  filePath: `src/${id}.ts`,
  kind: 'function',
  startLine: 1,
  endLine: lines,
  source: Array.from({ length: lines }, (_, index) => `line${index}`).join(
    '\n',
  ),
});
const base = {
  topic: 'Hooks',
  kind: 'CONCEPT',
  reportMd: '본문',
  sourceUrls: ['https://a.example'],
};

describe('buildStudyApplicabilityPrompt', () => {
  it('브리프를 untrusted 경계로 감싸고 후보를 id·파일:라인과 함께 싣는다', () => {
    const { prompt, sentCandidates } = buildStudyApplicabilityPrompt({
      ...base,
      candidates: [candidate('c1', 3)],
    });
    expect(prompt).toContain('<untrusted-input>');
    expect(prompt).toContain('[c1] src/c1.ts:1-3 fnc1 (function)');
    expect(sentCandidates.map((item) => item.id)).toEqual(['c1']);
  });

  it(`조각은 ${MAX_CHUNK_LINES}줄에서 자르고 표시한다`, () => {
    const { prompt } = buildStudyApplicabilityPrompt({
      ...base,
      candidates: [candidate('c1', MAX_CHUNK_LINES + 5)],
    });
    expect(prompt).toContain(`line${MAX_CHUNK_LINES - 1}`);
    expect(prompt).not.toContain(`line${MAX_CHUNK_LINES}\n`);
    expect(prompt).toContain('(이하 생략)');
  });

  it(`합계 ${MAX_CANDIDATE_CHARS}자를 넘기는 후보는 싣지 않고 sentCandidates 에서도 뺀다`, () => {
    const big = {
      ...candidate('c1', 1),
      source: 'x'.repeat(MAX_CANDIDATE_CHARS + 100),
    };
    const { prompt, sentCandidates } = buildStudyApplicabilityPrompt({
      ...base,
      candidates: [big, candidate('c2', 1)],
    });
    expect(sentCandidates.map((item) => item.id)).toEqual(['c1']);
    expect(sentCandidates[0].source.length).toBeLessThanOrEqual(
      MAX_CANDIDATE_CHARS,
    );
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('후보 2개 중 1개만 실었다');
  });

  it('줄 상한으로 잘린 나머지는 예산을 쓰지 않아 뒤 후보도 싣는다', () => {
    const hugeClass = {
      ...candidate('c1', 500),
      source: Array.from({ length: 500 }, () => 'x'.repeat(60)).join('\n'),
    };
    const { sentCandidates } = buildStudyApplicabilityPrompt({
      ...base,
      candidates: [hugeClass, candidate('c2', 3)],
    });
    expect(sentCandidates.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(sentCandidates[0].source.split('\n')).toHaveLength(MAX_CHUNK_LINES);
  });
});
