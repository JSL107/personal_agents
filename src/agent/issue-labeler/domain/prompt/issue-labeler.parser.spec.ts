import { IssueLabelerException } from '../issue-labeler.exception';
import { IssueLabelInference } from '../issue-labeler.type';
import { parseIssueLabelInference } from './issue-labeler.parser';

describe('parseIssueLabelInference', () => {
  const valid: IssueLabelInference = {
    labels: ['bug', 'priority:high'],
    reasoning:
      'Stack trace 가 포함된 명백한 버그 보고서. 우선순위는 정기 영향도 큰 path.',
  };

  it('JSON 문자열을 IssueLabelInference 로 파싱', () => {
    expect(parseIssueLabelInference(JSON.stringify(valid))).toEqual(valid);
  });

  it('```json 코드 펜스 감싼 응답도 벗겨낸 뒤 파싱', () => {
    const wrapped = ['```json', JSON.stringify(valid), '```'].join('\n');
    expect(parseIssueLabelInference(wrapped)).toEqual(valid);
  });

  it('labels 가 빈 배열인 정상 응답도 허용', () => {
    const empty: IssueLabelInference = {
      labels: [],
      reasoning: '명확히 적합한 label 없음 — 사람이 직접 분류 권장.',
    };
    expect(parseIssueLabelInference(JSON.stringify(empty))).toEqual(empty);
  });

  it('JSON 으로 파싱 불가하면 INVALID_MODEL_OUTPUT 예외', () => {
    expect(() => parseIssueLabelInference('not json')).toThrow(
      IssueLabelerException,
    );
  });

  it('labels 가 string[] 가 아니면 예외', () => {
    const broken = { labels: [1, 2], reasoning: 'x' };
    expect(() => parseIssueLabelInference(JSON.stringify(broken))).toThrow(
      IssueLabelerException,
    );
  });

  it('reasoning 누락 시 예외', () => {
    const broken = { labels: ['bug'] };
    expect(() => parseIssueLabelInference(JSON.stringify(broken))).toThrow(
      IssueLabelerException,
    );
  });
});
