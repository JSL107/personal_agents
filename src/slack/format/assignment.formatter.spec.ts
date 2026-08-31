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
  it('카드가 함께 나갈 때만 드롭다운을 안내한다', () => {
    const withCard = formatAssignmentOutput(output, { awaitingApproval: true });

    expect(withCard).toContain('드롭다운');
    expect(withCard).not.toContain('/be plan');
    expect(withCard).not.toContain('직접 호출');
  });

  // autopilot 아침 발송과 /retry-run 은 텍스트만 보낸다 — 드롭다운은 카드의 블록에만
  // 붙으므로, 그 경로에서 드롭다운을 안내하면 사용자는 없는 UI 를 찾게 된다.
  it('카드 없이 텍스트만 나가면 드롭다운 대신 말로 답하는 법을 안내한다', () => {
    const withoutCard = formatAssignmentOutput(output);

    expect(withoutCard).not.toContain('드롭다운');
    expect(withoutCard).toContain('말로');
    expect(withoutCard).not.toContain('/be plan');
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

    expect(text).toContain('자동 배정 0건');
    expect(text).toContain('테스트 보강');
    expect(text).toContain('경계 모호');
  });

  // 제목·본문·보류 사유가 같은 사실을 세 번 말하면 정보량 한 줄짜리 카드가 문단
  // 여러 개로 불어난다 — 8일 연속 배정 0건이던 아침 카드의 실제 모습이다.
  it('배정 0건을 제목에서 한 번만 말한다', () => {
    const text = formatAssignmentOutput({
      assignments: [],
      unassignedTasks: [
        { taskId: 't:2', taskTitle: '테스트 보강', reason: '경계 모호' },
      ],
      ctoSummary: '전부 보류',
    });

    expect(text.match(/0건|없음/g)).toHaveLength(1);
  });

  // 보류가 남은 회차의 사용자 행동은 "담당 고르기" 다 — 예시가 그것을 보여야 한다.
  it('보류가 있으면 담당을 정하는 예시를 안내한다', () => {
    const text = formatAssignmentOutput({
      assignments: [],
      unassignedTasks: [
        { taskId: 't:2', taskTitle: '테스트 보강', reason: '경계 모호' },
      ],
      ctoSummary: '전부 보류',
    });

    expect(text).toContain('담당은 말로 정해주세요');
  });
});
