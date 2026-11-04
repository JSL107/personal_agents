import { EvaluationOutput } from '../../agent/po-eval/domain/po-eval.type';
import { formatEvaluationOutput } from './po-evaluation.formatter';

describe('formatEvaluationOutput', () => {
  it('Notion에 저장할 이력서 기록 초안을 상세에 보여 준다', () => {
    const output: EvaluationOutput = {
      range: 'TODAY',
      sourceAgentRuns: {},
      qualitative: { summary: '오늘 일', wins: [], blockers: [] },
      careerLog: {
        schemaVersion: 1,
        period: '2026-11-04',
        achievements: {
          quantitative: ['PR 3건 머지'],
          qualitative: ['Router 개선'],
        },
        technologies: ['NestJS'],
        impact: '응답 시간이 줄었어요',
      },
    };

    const report = formatEvaluationOutput(output);

    expect(report.detail).toContain('이력서 기록 초안');
    expect(report.detail).toContain('*정량 성과*\n• PR 3건 머지');
    expect(report.detail).toContain('*정성 성과*\n• Router 개선');
    expect(report.detail).toContain('*기술*\n• NestJS');
    expect(report.detail).toContain('*영향*\n응답 시간이 줄었어요');
    expect(report.detail).not.toContain('schemaVersion');
  });
});
