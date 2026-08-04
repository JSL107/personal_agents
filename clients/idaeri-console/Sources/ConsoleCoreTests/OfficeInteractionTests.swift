import Foundation

@testable import ConsoleCore

func runOfficeInteractionTests(_ t: TestRunner) {
    t.suite("OfficeInteraction")

    let slots: [(agentType: String, point: OfficePoint)] = [
        ("PM", OfficePoint(x: 100, y: 100)),
        ("CTO", OfficePoint(x: 300, y: 100)),
    ]

    // 원 중심 근처 클릭 → 그 agentType
    t.expectEqual(agentTypeAt(point: OfficePoint(x: 108, y: 104), slots: slots, radius: 26), "PM", "중심 근처 → PM")

    // 어떤 원과도 먼 클릭 → nil
    t.expectNil(agentTypeAt(point: OfficePoint(x: 200, y: 400), slots: slots, radius: 26), "빈 공간 클릭 → nil")

    // 겹치는 반경이면 더 가까운 쪽
    t.expectEqual(agentTypeAt(point: OfficePoint(x: 295, y: 100), slots: slots, radius: 300), "CTO", "가장 가까운 원 선택")

    // approvalFor: 해당 agentType 의 승인 건
    let approvals = [
        ConsoleApproval(id: "a1", agentType: "CTO", title: "PR1", createdAt: "t1"),
        ConsoleApproval(id: "a2", agentType: "PM", title: "PR2", createdAt: "t2"),
    ]
    t.expectEqual(approvalFor(agentType: "PM", in: approvals)?.id, "a2", "PM 승인 건 매칭")
    t.expectNil(approvalFor(agentType: "BE", in: approvals), "승인 없는 에이전트 → nil")

    // 이름표 세기 — 기본은 옅게, 손이 필요한 상태와 지금 보고 있는 대상만 진하게.
    // 27명 전원이 늘 진한 딱지를 달면 상태 링이 라벨에 덮인다.
    t.expect(
        nameplateIsEmphasized(state: .awaitingApproval, isHovered: false, isSelected: false),
        "승인 대기는 강조"
    )
    t.expect(
        nameplateIsEmphasized(state: .failed, isHovered: false, isSelected: false),
        "실패는 강조"
    )
    t.expect(
        nameplateIsEmphasized(state: .waiting, isHovered: true, isSelected: false),
        "마우스 올린 대상은 상태와 무관하게 강조"
    )
    t.expect(
        nameplateIsEmphasized(state: .completed, isHovered: false, isSelected: true),
        "선택된 대상은 강조"
    )
    for quiet in [ConsoleAgentState.waiting, .inProgress, .completed, .awaitingIntegration] {
        t.expect(
            !nameplateIsEmphasized(state: quiet, isHovered: false, isSelected: false),
            "\(quiet.rawValue) 는 기본 세기"
        )
    }
}
