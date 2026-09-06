import { AgentType } from '../model-router/domain/model-router.type';
import {
  AGENT_CONTRACTS,
  buildContractPreamble,
  Department,
  DEPARTMENT_LABEL,
} from './agent-contract';

describe('AGENT_CONTRACTS', () => {
  it('AgentType enum 의 모든 에이전트가 계약을 가진다', () => {
    // Record<AgentType, ...> 타입이 컴파일 타임에 강제하지만, enum 에서 값을
    // 제거했을 때 계약이 유령으로 남는 경우는 런타임에서만 잡힌다.
    expect(Object.keys(AGENT_CONTRACTS).sort()).toEqual(
      Object.values(AgentType).sort(),
    );
  });

  it('모든 부서에 한글 표시명이 있다', () => {
    for (const department of Object.values(Department)) {
      expect(DEPARTMENT_LABEL[department]).toBeTruthy();
    }
  });

  it('6개 부서 모두에 최소 한 명이 배정된다', () => {
    // 콘솔 평면도(OfficeFloorPlan)는 소속 에이전트가 있는 부서만 구역으로 그린다.
    // 빈 부서가 생기면 화면에서 구역이 통째로 사라지므로 배치 누락을 여기서 잡는다.
    const staffed = new Set(
      Object.values(AGENT_CONTRACTS).map((contract) => contract.department),
    );

    expect([...staffed].sort()).toEqual(Object.values(Department).sort());
  });

  it('모든 계약이 하는 일(job)을 명시한다', () => {
    for (const [agentType, contract] of Object.entries(AGENT_CONTRACTS)) {
      expect(contract.job.trim()).not.toBe('');
      expect(`${agentType}:${contract.job}`).not.toContain('undefined');
    }
  });

  it('다음 부서로 자기 자신을 지정하지 않는다', () => {
    for (const [agentType, contract] of Object.entries(AGENT_CONTRACTS)) {
      expect(contract.nextAgent).not.toBe(agentType);
    }
  });

  it('근거를 요구하는 계약은 산출물 필수 필드도 함께 정의한다', () => {
    // 산출물 형태를 실측하지 못해 스텁으로 둔 계약에 근거만 요구하면,
    // 무엇을 근거로 담아야 하는지 모델에게 알려줄 방법이 없다.
    for (const contract of Object.values(AGENT_CONTRACTS)) {
      if (contract.requireEvidence) {
        expect(contract.deliverableFields.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('buildContractPreamble', () => {
  it('계약이 있는 에이전트는 필수 필드를 머리말에 싣는다', () => {
    const preamble = buildContractPreamble(AgentType.EVENING_RETRO);

    expect(preamble).not.toBeNull();
    for (const field of AGENT_CONTRACTS[AgentType.EVENING_RETRO]
      .deliverableFields) {
      expect(preamble).toContain(field);
    }
  });

  it('output 을 usecase 가 조립하는 에이전트는 검수를 켜고도 머리말을 넣지 않는다', () => {
    // 이 다섯은 모델 응답과 저장되는 output 의 스키마가 다르다. 머리말이 output 키를
    // 요구하면 모델이 존재하지 않는 스키마를 내려 하고 원래 응답 파서가 깨진다.
    const assembled = [
      AgentType.HUMANIZER,
      AgentType.PAPER_RECOMMEND,
      AgentType.PAPER_TRADE,
      AgentType.SUBCONSCIOUS_GATE,
      AgentType.BLOG_PUBLISH,
    ];

    for (const agentType of assembled) {
      const contract = AGENT_CONTRACTS[agentType];
      expect(contract.skipPreamble).toBe(true);
      // 검사는 켜져 있어야 한다 — 머리말만 끄는 것이 이 플래그의 목적이다.
      expect(contract.deliverableFields.length).toBeGreaterThan(0);
      expect(buildContractPreamble(agentType)).toBeNull();
    }
  });

  it('output 이 모델 응답 그대로인 에이전트는 머리말을 유지한다', () => {
    // 여기서 머리말을 끄면 모델이 계약을 모른 채 답하게 된다 — 이 기능의 원래 목적을 잃는다.
    for (const agentType of [AgentType.EVENING_RETRO]) {
      expect(AGENT_CONTRACTS[agentType].skipPreamble).toBeUndefined();
      expect(buildContractPreamble(agentType)).not.toBeNull();
    }
  });

  it('skipPreamble 을 쓰는 계약은 산출물 검사가 켜져 있어야 한다', () => {
    // 검사도 끄고 머리말도 끄면 스텁과 같다 — 플래그를 쓸 이유가 없다.
    for (const [agentType, contract] of Object.entries(AGENT_CONTRACTS)) {
      if (contract.skipPreamble !== true) {
        continue;
      }
      expect(contract.deliverableFields.length > 0).toBe(true);
      expect(agentType).toBeTruthy();
    }
  });
});
