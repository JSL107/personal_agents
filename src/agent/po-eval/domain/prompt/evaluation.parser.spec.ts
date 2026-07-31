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

  // 2026-07-23 daily-eval 실패(AgentRun #247) 재발 대비 — 당시 진단 메시지가 앞 120자로
  // 잘려 저장돼(AgentRun.output.error 는 error.message 만 보관) 원인이 "응답 잘림" 인지
  // "문자열 내 제어문자" 인지 사후에 가릴 수 없었다. 길이 + 끝부분 + 원인을 남긴다.
  describe('파싱 실패 진단', () => {
    const catchMessage = (raw: string): string => {
      let caught: Error | undefined;
      try {
        parseEvaluationOutput(raw);
      } catch (error) {
        caught = error as Error;
      }
      expect(caught).toBeDefined();
      return caught?.message ?? '';
    };

    it('응답이 중간에 잘린 경우 길이·끝부분·원인을 메시지에 남긴다', () => {
      const truncated = `{"qualitative":{"summary":"${'가'.repeat(400)}여기서_끊김`;

      const message = catchMessage(truncated);

      expect(message).toContain(`len=${truncated.length}`);
      expect(message).toContain('여기서_끊김');
      expect(message).toMatch(/cause=/);
    });

    it('앞부분도 함께 남겨 어떤 응답이었는지 식별할 수 있다', () => {
      const truncated = `{"qualitative":{"summary":"시작_표식${'나'.repeat(400)}끝_표식`;

      const message = catchMessage(truncated);

      expect(message).toContain('시작_표식');
      expect(message).toContain('끝_표식');
    });

    it('진단 메시지가 무한히 길어지지 않는다 (로그·DB 보호)', () => {
      const huge = `{"qualitative":"${'다'.repeat(50_000)}`;

      const message = catchMessage(huge);

      expect(message.length).toBeLessThan(1_200);
    });
  });
});
