import { AssignmentOutput } from '../../agent/cto/domain/cto.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import { formatAssignmentOutput } from './assignment.formatter';

const output: AssignmentOutput = {
  assignments: [
    {
      taskId: 't:1',
      taskTitle: 'Router 마무리',
      beAssignment: AgentType.BE,
      priority: 1,
      reasoning: 'BE 진입 worker',
      confidence: 0.9,
    },
  ],
  unassignedTasks: [],
  ctoSummary: '1건 분배',
};

describe('formatAssignmentOutput', () => {
  // 카드의 버튼이 정식 경로지만, 텍스트로 "응" 해도 승인되므로 둘 다 안내한다.
  it('승인 카드가 열렸으면 실행 버튼 + "응" 안내를 붙인다', () => {
    const text = formatAssignmentOutput(output, { awaitingApproval: true });

    expect(text).toContain('이대로 진행할까요?');
    expect(text).toContain('🚀 실행');
    expect(text).toContain('`응`');
  });

  // 카드가 없는데 실행하라고 하면 눌러도/답해도 아무 일이 안 일어난다.
  it('승인 카드가 없으면 실행 안내를 붙이지 않는다', () => {
    const text = formatAssignmentOutput(output);

    expect(text).not.toContain('이대로 진행할까요?');
  });

  // 배정 변경은 드롭다운이 정식 경로 — 안내가 슬래시를 가리키면 안 된다.
  it('배정 변경 안내는 항상 노출되고, 슬래시 호출을 지시하지 않는다', () => {
    const withCard = formatAssignmentOutput(output, { awaitingApproval: true });
    const withoutCard = formatAssignmentOutput(output);

    for (const text of [withCard, withoutCard]) {
      expect(text).toContain('드롭다운');
      expect(text).not.toContain('/be plan');
      expect(text).not.toContain('직접 호출');
    }
  });

  it('분배 라인과 ctoSummary 를 본문에 담는다 (회귀)', () => {
    const text = formatAssignmentOutput(output, { awaitingApproval: true });

    expect(text).toContain('CTO 분배 결과');
    expect(text).toContain('1건 분배');
    expect(text).toContain('Router 마무리');
    expect(text).toContain('[BE]');
  });

  it('분배 0건이면 보류 안내를 노출 (회귀)', () => {
    const text = formatAssignmentOutput({
      assignments: [],
      unassignedTasks: [
        { taskId: 't:2', taskTitle: '테스트 보강', reason: '경계 모호' },
      ],
      ctoSummary: '전부 보류',
    });

    expect(text).toContain('분배된 task 없음');
    expect(text).toContain('테스트 보강');
    expect(text).toContain('경계 모호');
  });
});
