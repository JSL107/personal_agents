import { PoShadowException } from '../po-shadow.exception';
import { PoShadowReport } from '../po-shadow.type';
import { parsePoShadowReport } from './po-shadow.parser';
import { PO_SHADOW_OUTPUT_SCHEMA } from './po-shadow.schema';

const validReport = (): PoShadowReport => ({
  schemaVersion: 2,
  quiet: false,
  headline: '#264 업로드 차단부터 해소하세요.',
  findings: [
    {
      factIds: ['stalled:acme/app#264'],
      point: '#264 업로드 작업이 멈췄습니다.',
      suggestion: '리뷰어를 지정하세요.',
    },
  ],
  purposeConflict: null,
  factSummary: [],
  droppedFindingCount: 0,
  degradedSources: [],
});

describe('parsePoShadowReport', () => {
  it('코드 펜스 안의 유효한 v2 report를 파싱한다', () => {
    const report = validReport();

    expect(
      parsePoShadowReport(`\`\`\`json\n${JSON.stringify(report)}\n\`\`\``),
    ).toEqual(report);
  });

  it.each([
    ['schemaVersion', { ...validReport(), schemaVersion: 1 }],
    ['quiet', { ...validReport(), quiet: 'false' }],
    ['headline', { ...validReport(), headline: 264 }],
    ['findings', { ...validReport(), findings: 'not-an-array' }],
    ['purposeConflict', { ...validReport(), purposeConflict: 264 }],
    ['factSummary', { ...validReport(), factSummary: [264] }],
    ['droppedFindingCount', { ...validReport(), droppedFindingCount: -1 }],
  ])('%s 필드 타입이나 값이 틀리면 거부한다', (_field, report) => {
    expect(() => parsePoShadowReport(JSON.stringify(report))).toThrow(
      PoShadowException,
    );
  });

  it.each([
    'schemaVersion',
    'quiet',
    'headline',
    'findings',
    'purposeConflict',
    'factSummary',
    'droppedFindingCount',
  ])('%s 필드가 없으면 거부한다', (field) => {
    const report: Record<string, unknown> = { ...validReport() };
    delete report[field];

    expect(() => parsePoShadowReport(JSON.stringify(report))).toThrow(
      PoShadowException,
    );
  });

  it.each([
    [
      '빈 factIds',
      {
        ...validReport(),
        findings: [
          {
            factIds: [],
            point: '문제입니다.',
            suggestion: '처리하세요.',
          },
        ],
      },
    ],
    [
      '문자열이 아닌 factId',
      {
        ...validReport(),
        findings: [
          {
            factIds: [264],
            point: '문제입니다.',
            suggestion: '처리하세요.',
          },
        ],
      },
    ],
    [
      '문자열이 아닌 point',
      {
        ...validReport(),
        findings: [
          {
            factIds: ['stalled:acme/app#264'],
            point: 264,
            suggestion: '처리하세요.',
          },
        ],
      },
    ],
    [
      '문자열이 아닌 suggestion',
      {
        ...validReport(),
        findings: [
          {
            factIds: ['stalled:acme/app#264'],
            point: '문제입니다.',
            suggestion: null,
          },
        ],
      },
    ],
    [
      'finding 4개',
      {
        ...validReport(),
        findings: Array.from({ length: 4 }, () => validReport().findings[0]),
      },
    ],
  ])('%s인 finding을 거부한다', (_caseName, report) => {
    expect(() => parsePoShadowReport(JSON.stringify(report))).toThrow(
      PoShadowException,
    );
  });

  it('purposeConflict는 문자열도 허용한다', () => {
    const report = {
      ...validReport(),
      purposeConflict: '계획 1순위보다 실패 복구가 먼저입니다.',
    };

    expect(parsePoShadowReport(JSON.stringify(report))).toEqual(report);
  });

  it.each([
    ['quiet=true', { ...validReport(), quiet: true }],
    [
      '비어 있지 않은 factSummary',
      { ...validReport(), factSummary: ['모델이 만든 요약'] },
    ],
    [
      '0이 아닌 droppedFindingCount',
      { ...validReport(), droppedFindingCount: 1 },
    ],
  ])('모델 전용 bookkeeping 값이 %s이면 거부한다', (_caseName, report) => {
    expect(() => parsePoShadowReport(JSON.stringify(report))).toThrow(
      PoShadowException,
    );
  });

  it.each([
    ['공백 headline', { ...validReport(), headline: '   ' }],
    ['80자를 넘는 headline', { ...validReport(), headline: '가'.repeat(81) }],
    [
      '공백 point',
      {
        ...validReport(),
        findings: [{ ...validReport().findings[0], point: '   ' }],
      },
    ],
    [
      '60자를 넘는 point',
      {
        ...validReport(),
        findings: [{ ...validReport().findings[0], point: '가'.repeat(61) }],
      },
    ],
    [
      '공백 suggestion',
      {
        ...validReport(),
        findings: [{ ...validReport().findings[0], suggestion: '   ' }],
      },
    ],
    [
      '60자를 넘는 suggestion',
      {
        ...validReport(),
        findings: [
          { ...validReport().findings[0], suggestion: '가'.repeat(61) },
        ],
      },
    ],
    ['공백 purposeConflict', { ...validReport(), purposeConflict: '   ' }],
  ])('%s을 거부한다', (_caseName, report) => {
    expect(() => parsePoShadowReport(JSON.stringify(report))).toThrow(
      PoShadowException,
    );
  });

  it('provider output schema도 모델 전용 값과 nonblank 문자열을 강제한다', () => {
    const properties = PO_SHADOW_OUTPUT_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    const findingProperties = (
      properties.findings.items as Record<string, unknown>
    ).properties as Record<string, Record<string, unknown>>;

    expect(properties.quiet.enum).toEqual([false]);
    expect(properties.factSummary.maxItems).toBe(0);
    expect(properties.droppedFindingCount.enum).toEqual([0]);
    expect(properties.headline).toMatchObject({
      maxLength: 80,
      pattern: '.*\\S.*',
    });
    expect(findingProperties.point).toMatchObject({
      maxLength: 60,
      pattern: '.*\\S.*',
    });
    expect(findingProperties.suggestion).toMatchObject({
      maxLength: 60,
      pattern: '.*\\S.*',
    });
    expect(properties.purposeConflict).toMatchObject({ pattern: '.*\\S.*' });
  });

  it('허용되지 않은 top-level key가 있으면 거부한다', () => {
    const report = { ...validReport(), unexpected: 'extra' };

    expect(() => parsePoShadowReport(JSON.stringify(report))).toThrow(
      PoShadowException,
    );
  });

  it('finding에 허용되지 않은 key가 있으면 거부한다', () => {
    const report = {
      ...validReport(),
      findings: [
        {
          ...validReport().findings[0],
          unexpected: 'extra',
        },
      ],
    };

    expect(() => parsePoShadowReport(JSON.stringify(report))).toThrow(
      PoShadowException,
    );
  });
});
