import { PoEvalErrorCode } from '../po-eval-error-code.enum';
import { parseEvaluationOutput } from './evaluation.parser';

describe('parseEvaluationOutput', () => {
  const validResponse = {
    qualitative: {
      summary: '주간 회고 — Router 완료',
      blockers: ['Slack manifest 갱신 대기'],
      wins: ['Router 8 step 완료', 'CTO worker 도입'],
    },
    careerLog: {
      schemaVersion: 1,
      period: '2026-W22',
      achievements: {
        quantitative: ['PR 3건 머지', 'spec +50건'],
        qualitative: ['Router 도입 완료'],
      },
      technologies: ['NestJS', 'Prisma'],
      impact: 'V3 비전 phase 1~2 가 사용자 가시 활성화됨.',
    },
  };

  it('정상 JSON 을 EvaluationLlmOutput 으로 파싱', () => {
    const result = parseEvaluationOutput(JSON.stringify(validResponse));

    expect(result.qualitative.summary).toContain('Router');
    expect(result.qualitative.blockers).toHaveLength(1);
    expect(result.qualitative.wins).toHaveLength(2);
    expect(result.careerLog.schemaVersion).toBe(1);
    expect(result.careerLog.achievements.quantitative).toContain('PR 3건 머지');
    expect(result.careerLog.technologies).toContain('NestJS');
  });

  it('```json fence 로 감싸진 응답도 graceful', () => {
    const raw = '```json\n' + JSON.stringify(validResponse) + '\n```';
    const result = parseEvaluationOutput(raw);
    expect(result.qualitative.summary).toContain('Router');
  });

  it('schemaVersion 은 LLM 응답 무관하게 1 로 강제', () => {
    const overrided = {
      ...validResponse,
      careerLog: { ...validResponse.careerLog, schemaVersion: 2 },
    };

    const result = parseEvaluationOutput(JSON.stringify(overrided));

    expect(result.careerLog.schemaVersion).toBe(1);
  });

  it('qualitative 누락이면 PARSE_FAILED', () => {
    const broken = { careerLog: validResponse.careerLog };

    expect(() => parseEvaluationOutput(JSON.stringify(broken))).toThrow(
      expect.objectContaining({
        poEvalErrorCode: PoEvalErrorCode.PARSE_FAILED,
      }),
    );
  });

  it('careerLog.achievements 가 객체 아니면 PARSE_FAILED', () => {
    const broken = {
      ...validResponse,
      careerLog: { ...validResponse.careerLog, achievements: 'foo' },
    };

    expect(() => parseEvaluationOutput(JSON.stringify(broken))).toThrow(
      expect.objectContaining({
        poEvalErrorCode: PoEvalErrorCode.PARSE_FAILED,
      }),
    );
  });

  it('string array 필드들이 array 아닌 값이면 PARSE_FAILED', () => {
    const broken = {
      ...validResponse,
      qualitative: { ...validResponse.qualitative, blockers: 'not array' },
    };

    expect(() => parseEvaluationOutput(JSON.stringify(broken))).toThrow(
      expect.objectContaining({
        poEvalErrorCode: PoEvalErrorCode.PARSE_FAILED,
      }),
    );
  });

  it('JSON parse 실패 시 PARSE_FAILED', () => {
    expect(() => parseEvaluationOutput('not json')).toThrow(
      expect.objectContaining({
        poEvalErrorCode: PoEvalErrorCode.PARSE_FAILED,
      }),
    );
  });

  it('mergedPrReview 를 overall + prs(prNumber/evaluation) 로 파싱', () => {
    const withPrReview = {
      ...validResponse,
      mergedPrReview: {
        overall: '오늘 PR 2건 모두 인프라 안정화 성격',
        prs: [
          { prNumber: 110, evaluation: '타임아웃 상수 조정 — 난이도 낮음' },
          { prNumber: 109, evaluation: 'episodic 의미검색 강화 — 중간 난이도' },
        ],
      },
    };

    const result = parseEvaluationOutput(JSON.stringify(withPrReview));

    expect(result.mergedPrReview).toEqual({
      overall: '오늘 PR 2건 모두 인프라 안정화 성격',
      prs: [
        { prNumber: 110, evaluation: '타임아웃 상수 조정 — 난이도 낮음' },
        { prNumber: 109, evaluation: 'episodic 의미검색 강화 — 중간 난이도' },
      ],
    });
  });

  it('mergedPrReview 가 없으면 undefined', () => {
    const result = parseEvaluationOutput(JSON.stringify(validResponse));

    expect(result.mergedPrReview).toBeUndefined();
  });

  it('prs 의 잘못된 항목(prNumber 비숫자)은 제외하고 나머지는 유지', () => {
    const withBrokenPr = {
      ...validResponse,
      mergedPrReview: {
        overall: 'o',
        prs: [
          { prNumber: 'x', evaluation: 'a' },
          { prNumber: 7, evaluation: 'b' },
        ],
      },
    };

    const result = parseEvaluationOutput(JSON.stringify(withBrokenPr));

    expect(result.mergedPrReview?.prs).toEqual([
      { prNumber: 7, evaluation: 'b' },
    ]);
  });
});
