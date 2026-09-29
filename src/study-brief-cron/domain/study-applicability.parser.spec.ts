import { parseApplicabilityOutput } from './study-applicability.parser';
import { StudyBriefException } from './study-brief.exception';

describe('parseApplicabilityOutput', () => {
  it('정상 JSON 을 읽는다(코드펜스 허용)', () => {
    const result = parseApplicabilityOutput(
      '```json\n{"verdict":"APPLY","reason":"r","citations":[{"chunkId":"c1","why":"w"}],"proposal":{"title":"t","problem":"p","change":"c","verify":"v"}}\n```',
    );
    expect(result).toEqual({
      verdict: 'APPLY',
      reason: 'r',
      citations: [{ chunkId: 'c1', why: 'w' }],
      proposal: { title: 't', problem: 'p', change: 'c', verify: 'v' },
    });
  });

  it('proposal null 을 허용한다', () => {
    expect(
      parseApplicabilityOutput(
        '{"verdict":"NOT_APPLICABLE","reason":"r","citations":[],"proposal":null}',
      ).proposal,
    ).toBeNull();
  });

  it.each([
    ['JSON 아님', 'not json'],
    [
      'verdict 오타',
      '{"verdict":"APPLIED","reason":"r","citations":[],"proposal":null}',
    ],
    [
      'citation 형태',
      '{"verdict":"APPLY","reason":"r","citations":[{"chunkId":1}],"proposal":null}',
    ],
    [
      'proposal 필드 누락',
      '{"verdict":"APPLY","reason":"r","citations":[],"proposal":{"title":"t"}}',
    ],
  ])('%s 이면 예외', (_, text) => {
    expect(() => parseApplicabilityOutput(text)).toThrow(StudyBriefException);
  });
});
