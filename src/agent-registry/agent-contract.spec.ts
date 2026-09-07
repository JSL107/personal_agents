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

  // 예전에는 여기에 "6개 부서 모두에 최소 한 명" 을 강제하는 테스트가 있었다. 콘솔 평면도가
  // 인원 있는 부서만 구역으로 그려서, 부서가 비면 화면에 칠 안 된 구멍이 남았기 때문이다.
  //
  // 그 강제가 배정을 망가뜨렸다. 직무와 무관하게 "누군가 그 방에 있어야 한다" 는 이유로
  // 워커를 옮기게 되고, 실제로 `CODE_REVIEWER` 가 그렇게 개발방으로 갔다(#479). 원인을
  // 화면 쪽에서 고쳤으므로(빈 방도 그린다 — `OfficeFloorPlan.zoneDepartments`) 여기서
  // 인원을 강제할 이유가 없어졌다. 빈 부서는 이제 정상 상태다.
  //
  // 회귀 방지는 화면 쪽에 있다: `OfficeFloorPlanTests` 의 "인원이 없는 부서도 구역을 받는다".

  it('어느 부서도 콘솔 자리표 정원을 넘지 않는다', () => {
    // 자리표를 넘기면 사람이 예비 격자로 밀려 이름표가 서로 겹친다 — 과거에 콘솔 검증
    // 10건이 그렇게 깨졌다. 정원의 정본은 콘솔이고(`OfficeFloorPlan.swift` 의
    // `departmentDeskSpots`), 여기 값은 그 좌석 개수를 옮겨 적은 것이다.
    // **Swift 쪽 좌석을 줄이면 이 표도 함께 줄여야 한다.**
    const deskCapacity: Record<Department, number> = {
      [Department.PLANNING]: 6,
      [Department.QUALITY]: 8,
      [Department.EVALUATION]: 8,
      [Department.TREASURY]: 5,
      [Department.CONTENT]: 12,
      [Department.INTERNAL_OPS]: 13,
    };

    const headcount = new Map<Department, number>();
    for (const contract of Object.values(AGENT_CONTRACTS)) {
      headcount.set(
        contract.department,
        (headcount.get(contract.department) ?? 0) + 1,
      );
    }

    const overflowing = [...headcount.entries()]
      .filter(([department, count]) => count > deskCapacity[department])
      .map(
        ([department, count]) =>
          `${department}: ${count}명 / ${deskCapacity[department]}석`,
      );

    expect(overflowing).toEqual([]);
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
