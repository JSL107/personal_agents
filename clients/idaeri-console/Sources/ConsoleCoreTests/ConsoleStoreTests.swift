import Foundation

@testable import ConsoleCore

/// ConsoleStore 가 스냅샷을 초기 상태로 싣고, SSE 증분 이벤트를 그 위에 올바로 적용하는지 검증.
func runConsoleStoreTests(_ t: TestRunner) {
    t.suite("ConsoleStore")

    let pm = ConsoleAgent(
        agentType: "PM",
        displayName: "PM",
        slashCommands: ["/today"],
        description: "",
        state: .waiting,
        bubble: "업무 대기중"
    )
    let be = ConsoleAgent(
        agentType: "BE",
        displayName: "BE",
        slashCommands: ["/plan-task"],
        description: "",
        state: .waiting,
        bubble: "업무 대기중"
    )
    let snapshot = ConsoleSnapshot(
        agents: [pm, be],
        runs: [],
        approvals: [],
        serverTime: "2026-07-27T00:00:00Z"
    )

    // 스냅샷 적용 = 초기 상태 적재
    let store = ConsoleStore()
    store.apply(snapshot: snapshot)
    t.expectEqual(store.agents.count, 2, "agents 적재")
    t.expectEqual(store.serverTime, "2026-07-27T00:00:00Z", "serverTime 적재")

    // state.changed 는 해당 에이전트 state 만 바꾸고 나머지는 불변
    store.apply(event: .stateChanged(agentType: "PM", state: .inProgress))
    t.expectEqual(store.agents.first(where: { $0.agentType == "PM" })?.state, .inProgress, "PM 상태 변경")
    t.expectEqual(store.agents.first(where: { $0.agentType == "BE" })?.state, .waiting, "BE 상태 불변")

    // state.changed 시 bubble 은 백엔드 소유라 클라이언트가 임의 변경하지 않는다(스냅샷 정정 대기)
    t.expectEqual(store.agents.first(where: { $0.agentType == "PM" })?.bubble, "업무 대기중", "bubble 유지")

    // 존재하지 않는 agentType 은 무시(크래시·추가 없음)
    store.apply(event: .stateChanged(agentType: "GHOST", state: .completed))
    t.expectEqual(store.agents.count, 2, "미지의 agentType 무시")

    // run.started → runs 에 추가
    let run = ConsoleRun(
        id: "r1",
        agentType: "PM",
        status: "IN_PROGRESS",
        parentId: nil,
        startedAt: "2026-07-27T00:01:00Z",
        finishedAt: nil
    )
    store.apply(event: .runStarted(run))
    t.expectEqual(store.runs.count, 1, "run 추가")
    t.expectEqual(store.runs.first?.status, "IN_PROGRESS", "run 상태")

    // run.finished(같은 id) → 중복 추가 없이 갱신
    let finished = ConsoleRun(
        id: "r1",
        agentType: "PM",
        status: "SUCCEEDED",
        parentId: nil,
        startedAt: "2026-07-27T00:01:00Z",
        finishedAt: "2026-07-27T00:02:00Z"
    )
    store.apply(event: .runFinished(finished))
    t.expectEqual(store.runs.count, 1, "run 중복 추가 안 함")
    t.expectEqual(store.runs.first?.status, "SUCCEEDED", "run 상태 갱신")
    t.expectEqual(store.runs.first?.finishedAt, "2026-07-27T00:02:00Z", "run 종료시각 갱신")

    // approval.opened → 추가, approval.resolved → 제거
    let approval = ConsoleApproval(
        id: "p1",
        agentType: nil,
        title: "발행 승인",
        createdAt: "2026-07-27T00:03:00Z"
    )
    store.apply(event: .approvalOpened(approval))
    t.expectEqual(store.approvals.count, 1, "approval 추가")
    store.apply(event: .approvalResolved(approval))
    t.expectEqual(store.approvals.count, 0, "approval 제거")
}
