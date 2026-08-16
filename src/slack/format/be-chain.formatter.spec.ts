import { Assignment, BeChainOutcome } from '../../agent/cto/domain/cto.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import { formatBeChainOutcomes } from './be-chain.formatter';

const assignment = (
  beAssignment: Assignment['beAssignment'],
  taskTitle: string,
): Assignment => ({
  taskId: `t:${taskTitle}`,
  taskTitle,
  beAssignment,
  priority: 2,
  reasoning: '',
  confidence: 0.9,
});

const outcome = (
  status: BeChainOutcome['status'],
  taskTitle: string,
  agentRunId?: number,
): BeChainOutcome => ({
  assignment: assignment(AgentType.BE, taskTitle),
  status,
  ...(agentRunId !== undefined ? { agentRunId } : {}),
  message: `${status} 메시지`,
});

describe('formatBeChainOutcomes', () => {
  it('성공 건수를 전체 대비로 요약한다', () => {
    const text = formatBeChainOutcomes([
      outcome('OK', 'a', 201),
      outcome('FAILED', 'b'),
      outcome('SKIPPED', 'c'),
    ]);

    expect(text).toContain('1/3건 성공');
  });

  // 건너뛴 항목과 사유가 사용자에게 필요한 정보다 — 뭉뚱그린 성공 요약으로 가리면 안 된다.
  it('건별 status 를 아이콘으로 구분해 모두 노출', () => {
    const text = formatBeChainOutcomes([
      outcome('OK', '성공건', 201),
      outcome('FAILED', '실패건'),
      outcome('SKIPPED', '건너뛴건'),
    ]);

    expect(text).toContain('✅');
    expect(text).toContain('❌');
    expect(text).toContain('⏭️');
    expect(text).toContain('성공건');
    expect(text).toContain('실패건');
    expect(text).toContain('건너뛴건');
  });

  it('run id 가 있으면 /retry-run 안내에 모아 노출', () => {
    const text = formatBeChainOutcomes([
      outcome('OK', 'a', 201),
      outcome('OK', 'b', 202),
    ]);

    expect(text).toContain('agentRunIds=[201, 202]');
    expect(text).toContain('/retry-run');
  });

  it('run id 가 하나도 없으면 retry 안내를 붙이지 않는다', () => {
    const text = formatBeChainOutcomes([outcome('SKIPPED', 'a')]);

    expect(text).not.toContain('/retry-run');
  });

  it('빈 결과는 실행할 분배가 없다고 알린다', () => {
    expect(formatBeChainOutcomes([])).toContain('실행할 분배가 없습니다');
  });
});
