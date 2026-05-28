import { CeoException } from '../ceo.exception';
import { CeoErrorCode } from '../ceo-error-code.enum';
import { parseMetaOutput } from './meta.parser';

describe('parseMetaOutput', () => {
  const validJson = JSON.stringify({
    contextDriftReport: {
      observations: [
        'PM plan 의 의도와 BE 실행 결과의 불일치 — 1건',
        '핵심 worker 부재 시간 길어짐',
      ],
    },
    docsQualityReport: {
      findings: ['CLAUDE.md §1 표 갱신 필요 — CEO 추가'],
    },
    finalSummary: '주간 흐름은 정상, drift 신호 1건 + 문서 갱신 1건.',
  });

  it('schema 에 맞는 JSON 을 MetaLlmOutput 으로 파싱', () => {
    const output = parseMetaOutput(validJson);
    expect(output.contextDriftReport.observations).toHaveLength(2);
    expect(output.docsQualityReport.findings).toHaveLength(1);
    expect(output.finalSummary).toContain('drift 신호 1건');
  });

  it('```json fence 가 앞뒤에 붙어 있어도 graceful', () => {
    const fenced = '```json\n' + validJson + '\n```';
    const output = parseMetaOutput(fenced);
    expect(output.contextDriftReport.observations).toHaveLength(2);
  });

  it('JSON parse 실패면 PARSE_FAILED 예외', () => {
    expect(() => parseMetaOutput('not-json')).toThrow(CeoException);
    try {
      parseMetaOutput('not-json');
    } catch (error) {
      expect((error as CeoException).ceoErrorCode).toBe(
        CeoErrorCode.PARSE_FAILED,
      );
    }
  });

  it('root 가 객체가 아니면 PARSE_FAILED 예외', () => {
    expect(() => parseMetaOutput('[]')).toThrow(CeoException);
    expect(() => parseMetaOutput('"string"')).toThrow(CeoException);
    expect(() => parseMetaOutput('null')).toThrow(CeoException);
  });

  it('contextDriftReport 가 객체 아니면 PARSE_FAILED 예외', () => {
    const bad = JSON.stringify({
      contextDriftReport: 'not-an-object',
      docsQualityReport: { findings: [] },
      finalSummary: '',
    });
    expect(() => parseMetaOutput(bad)).toThrow(CeoException);
  });

  it('docsQualityReport 가 객체 아니면 PARSE_FAILED 예외', () => {
    const bad = JSON.stringify({
      contextDriftReport: { observations: [] },
      docsQualityReport: 'not-an-object',
      finalSummary: '',
    });
    expect(() => parseMetaOutput(bad)).toThrow(CeoException);
  });

  it('observations 가 array 아니면 PARSE_FAILED 예외', () => {
    const bad = JSON.stringify({
      contextDriftReport: { observations: 'not-an-array' },
      docsQualityReport: { findings: [] },
      finalSummary: '',
    });
    expect(() => parseMetaOutput(bad)).toThrow(CeoException);
  });

  it('observations/findings 의 비-string element 는 filter 로 제거', () => {
    const mixed = JSON.stringify({
      contextDriftReport: { observations: ['ok', 1, null, 'ok2'] },
      docsQualityReport: { findings: ['f1', false, 'f2'] },
      finalSummary: '',
    });
    const output = parseMetaOutput(mixed);
    expect(output.contextDriftReport.observations).toEqual(['ok', 'ok2']);
    expect(output.docsQualityReport.findings).toEqual(['f1', 'f2']);
  });

  it('observations/findings 미정의면 빈 배열 fallback', () => {
    const missing = JSON.stringify({
      contextDriftReport: {},
      docsQualityReport: {},
      finalSummary: '',
    });
    const output = parseMetaOutput(missing);
    expect(output.contextDriftReport.observations).toEqual([]);
    expect(output.docsQualityReport.findings).toEqual([]);
  });

  it('finalSummary 가 string 아니면 빈 문자열 fallback', () => {
    const noSummary = JSON.stringify({
      contextDriftReport: { observations: [] },
      docsQualityReport: { findings: [] },
      finalSummary: 12345,
    });
    const output = parseMetaOutput(noSummary);
    expect(output.finalSummary).toBe('');
  });
});
