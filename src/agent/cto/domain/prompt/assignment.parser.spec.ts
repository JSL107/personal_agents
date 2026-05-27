import { AgentType } from '../../../../model-router/domain/model-router.type';
import { CtoErrorCode } from '../cto-error-code.enum';
import { parseAssignmentOutput } from './assignment.parser';

describe('parseAssignmentOutput', () => {
  it('정상 JSON 을 AssignmentOutput 으로 파싱 + confidence clamp 적용', () => {
    const raw = JSON.stringify({
      assignments: [
        {
          taskId: 'morning:1',
          taskTitle: 'user repository',
          beAssignment: 'BE',
          priority: 1,
          reasoning: '신규 도메인',
          confidence: 0.9,
        },
      ],
      unassignedTasks: [
        {
          taskId: 'morning:2',
          taskTitle: 'audit migration',
          reason: 'BE_SCHEMA + BE 분리 필요',
        },
      ],
      ctoSummary: '오늘 분배 — 1 BE, 1 unassigned.',
    });

    const result = parseAssignmentOutput(raw);

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toEqual({
      taskId: 'morning:1',
      taskTitle: 'user repository',
      beAssignment: AgentType.BE,
      priority: 1,
      reasoning: '신규 도메인',
      confidence: 0.9,
    });
    expect(result.unassignedTasks).toHaveLength(1);
    expect(result.ctoSummary).toContain('1 unassigned');
  });

  it('```json fence 로 감싸진 응답도 graceful 처리', () => {
    const raw =
      '```json\n' +
      JSON.stringify({
        assignments: [],
        unassignedTasks: [],
        ctoSummary: 'empty',
      }) +
      '\n```';

    const result = parseAssignmentOutput(raw);

    expect(result.assignments).toHaveLength(0);
    expect(result.ctoSummary).toBe('empty');
  });

  it('confidence 가 1 초과 / 음수면 [0,1] 로 clamp', () => {
    const raw = JSON.stringify({
      assignments: [
        {
          taskId: 't1',
          taskTitle: 't1',
          beAssignment: 'BE',
          priority: 2,
          reasoning: '',
          confidence: 1.7,
        },
        {
          taskId: 't2',
          taskTitle: 't2',
          beAssignment: 'BE_TEST',
          priority: 3,
          reasoning: '',
          confidence: -0.5,
        },
      ],
      ctoSummary: '',
    });

    const result = parseAssignmentOutput(raw);

    expect(result.assignments[0].confidence).toBe(1);
    expect(result.assignments[1].confidence).toBe(0);
  });

  it('beAssignment 가 허용 외 worker (BE_SRE / BE_FIX 등) 이면 PARSE_FAILED', () => {
    const raw = JSON.stringify({
      assignments: [
        {
          taskId: 't',
          taskTitle: 't',
          beAssignment: 'BE_SRE',
          priority: 1,
          reasoning: '',
          confidence: 0.9,
        },
      ],
      ctoSummary: '',
    });

    expect(() => parseAssignmentOutput(raw)).toThrow(
      expect.objectContaining({ ctoErrorCode: CtoErrorCode.PARSE_FAILED }),
    );
  });

  it('priority 가 1/2/3 외 값이면 PARSE_FAILED', () => {
    const raw = JSON.stringify({
      assignments: [
        {
          taskId: 't',
          taskTitle: 't',
          beAssignment: 'BE',
          priority: 0,
          reasoning: '',
          confidence: 0.9,
        },
      ],
      ctoSummary: '',
    });

    expect(() => parseAssignmentOutput(raw)).toThrow(
      expect.objectContaining({ ctoErrorCode: CtoErrorCode.PARSE_FAILED }),
    );
  });

  it('JSON parse 실패 시 PARSE_FAILED', () => {
    expect(() => parseAssignmentOutput('not json')).toThrow(
      expect.objectContaining({ ctoErrorCode: CtoErrorCode.PARSE_FAILED }),
    );
  });

  it('unassignedTasks 미존재도 graceful — 빈 배열로 반환', () => {
    const raw = JSON.stringify({
      assignments: [],
      ctoSummary: 'no work',
    });

    const result = parseAssignmentOutput(raw);

    expect(result.unassignedTasks).toEqual([]);
  });
});
