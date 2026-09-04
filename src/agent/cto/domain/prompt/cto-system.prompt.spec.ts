import { AGENT_CONTRACTS } from '../../../../agent-registry/agent-contract';
import { AgentType } from '../../../../model-router/domain/model-router.type';
import { CTO_SYSTEM_PROMPT } from './cto-system.prompt';

// 계약(`agent-contract.ts`)은 ctoSummary 를 필수 필드로 요구하는데, 프롬프트는 한동안
// "배정이 하나도 없으면 빈 문자열로 둔다" 고 지시했다. 그래서 배정 0건 실행은 지시대로
// 동작하고도 원장에 계약 위반으로 찍혔다 (2026-09 실측 run#2161·#2311).
//
// 두 규칙은 같은 것을 말해야 한다. 한쪽만 고치면 다시 어긋나므로 여기서 함께 못 박는다.
describe('CTO_SYSTEM_PROMPT — 계약과의 정합', () => {
  it('계약이 요구하는 필수 필드를 프롬프트가 모두 언급한다', () => {
    const contract = AGENT_CONTRACTS[AgentType.CTO];

    for (const field of contract.deliverableFields) {
      expect(CTO_SYSTEM_PROMPT).toContain(field);
    }
  });

  it('필수 필드인 ctoSummary 를 비우라고 지시하지 않는다', () => {
    expect(AGENT_CONTRACTS[AgentType.CTO].deliverableFields).toContain(
      'ctoSummary',
    );
    expect(CTO_SYSTEM_PROMPT).not.toContain('빈 문자열로 둔다');
  });

  it('배정 0건일 때 사유를 적으라고 지시한다', () => {
    expect(CTO_SYSTEM_PROMPT).toContain('배정이 하나도 없어도 비워두지 마라');
  });
});
