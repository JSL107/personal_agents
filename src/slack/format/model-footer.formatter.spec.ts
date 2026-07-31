import { AgentRunOutcome } from '../../agent-run/application/agent-run.service';
import { formatModelFooter } from './model-footer.formatter';

describe('formatModelFooter', () => {
  it('모델명과 실행 ID를 공통 푸터 형식으로 렌더', () => {
    const outcome: AgentRunOutcome<unknown> = {
      result: null,
      modelUsed: 'gpt-5.4-codex',
      agentRunId: 42,
    };

    expect(formatModelFooter(outcome)).toBe(
      '\n\n_model: gpt-5.4-codex · run #42_',
    );
  });

  it('모델명의 Slack 링크 제어문자를 제거하고 푸터 골격을 유지', () => {
    const outcome: AgentRunOutcome<unknown> = {
      result: null,
      modelUsed: 'gpt<5.4>|codex',
      agentRunId: 42,
    };

    const footer = formatModelFooter(outcome);

    expect(footer).toBe('\n\n_model: gpt5.4codex · run #42_');
    expect(footer).not.toContain('<');
    expect(footer).not.toContain('>');
    expect(footer).not.toContain('|');
    expect(footer).toContain('_model:');
    expect(footer).toContain('run #');
  });
});
