import Combine
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
        sessions: [],
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

    // ===== 승인 write 결과 반영 (SSE 도착 전 낙관적 처리 + 실패 안내) =====
    let writeStore = ConsoleStore()
    writeStore.apply(event: .approvalOpened(approval))
    t.expectNil(writeStore.approvalNotice, "초기 안내 없음")

    // 성공: SSE 를 기다리지 않고 즉시 사라진다.
    writeStore.resolveApprovalLocally(id: "p1")
    t.expectEqual(writeStore.approvals.count, 0, "승인 성공 시 낙관적 제거")

    // 뒤늦게 도착한 approval.resolved 가 같은 건을 또 지워도 안전해야 한다.
    writeStore.apply(event: .approvalResolved(approval))
    t.expectEqual(writeStore.approvals.count, 0, "SSE 중복 도착 멱등")

    // 없는 id 로 호출해도 다른 카드를 건드리지 않는다.
    writeStore.apply(event: .approvalOpened(approval))
    writeStore.resolveApprovalLocally(id: "does-not-exist")
    t.expectEqual(writeStore.approvals.count, 1, "미매칭 id 는 무해")

    // 실패: 사유가 남고, 다음 성공에서 지워진다.
    writeStore.setApprovalNotice("승인 실패 — 이미 처리됐거나 만료된 요청입니다.")
    t.expectEqual(
        writeStore.approvalNotice,
        "승인 실패 — 이미 처리됐거나 만료된 요청입니다.",
        "실패 사유 노출"
    )
    writeStore.setApprovalNotice(nil)
    t.expectNil(writeStore.approvalNotice, "성공 시 안내 해제")

    // 재동기화 스냅샷이 서버에서 사라진(만료) 카드를 화면에서 걷어낸다.
    let resyncStore = ConsoleStore()
    resyncStore.apply(event: .approvalOpened(approval))
    t.expectEqual(resyncStore.approvals.count, 1, "재동기화 전 카드 보유")
    resyncStore.apply(snapshot: ConsoleSnapshot(
        agents: [], runs: [], approvals: [], sessions: [], serverTime: "t"
    ))
    t.expectEqual(resyncStore.approvals.count, 0, "스냅샷 재동기화로 만료 카드 제거")

    // ===== pending 상태기계 =====
    let pendingStore = ConsoleStore()
    pendingStore.apply(snapshot: snapshot) // pm, be

    // enqueue → .sent
    let base = Date(timeIntervalSince1970: 1_000_000)
    let cmdId = pendingStore.enqueueCommand(text: "오늘 계획", agentTypeHint: "PM", sentAt: base)
    t.expectEqual(pendingStore.pendingCommands.count, 1, "pending 추가")
    t.expectEqual(pendingStore.pendingCommands.first?.phase, .sent, "초기 phase sent")

    // run.started(PM) → 힌트 일치 pending 을 .running 으로 바인딩
    let pmRun = ConsoleRun(id: "run-pm", agentType: "PM", status: "IN_PROGRESS", parentId: nil, startedAt: "t", finishedAt: nil)
    pendingStore.apply(event: .runStarted(pmRun))
    t.expectEqual(pendingStore.pendingCommands.first?.phase, .running, "sent→running")
    t.expectEqual(pendingStore.pendingCommands.first?.boundRunId, "run-pm", "runId 바인딩")
    t.expectEqual(pendingStore.pendingCommands.first?.resolvedAgentType, "PM", "resolvedAgentType 확정")

    // run.finished(같은 run) → .done
    let pmDone = ConsoleRun(id: "run-pm", agentType: "PM", status: "SUCCEEDED", parentId: nil, startedAt: "t", finishedAt: "t2")
    pendingStore.apply(event: .runFinished(pmDone))
    t.expectEqual(pendingStore.pendingCommands.first?.phase, .done, "running→done")

    // 힌트 없는 전역 명령 → run.started 의 agentType 으로 카드 확정
    let globalStore = ConsoleStore()
    let gid = globalStore.enqueueCommand(text: "리뷰 좀", agentTypeHint: nil, sentAt: base)
    let beRun = ConsoleRun(id: "run-be", agentType: "BE", status: "IN_PROGRESS", parentId: nil, startedAt: "t", finishedAt: nil)
    globalStore.apply(event: .runStarted(beRun))
    t.expectEqual(globalStore.pendingCommands.first?.resolvedAgentType, "BE", "전역→카드 이동")
    t.expectEqual(globalStore.pendingCommands.first?.effectiveAgentType, "BE", "effectiveAgentType")
    _ = gid

    // 다발: 힌트 PM 2개 + run.started PM 1개 → 가장 오래된 것만 바인딩
    let multiStore = ConsoleStore()
    let older = multiStore.enqueueCommand(text: "a", agentTypeHint: "PM", sentAt: base)
    let newer = multiStore.enqueueCommand(text: "b", agentTypeHint: "PM", sentAt: base.addingTimeInterval(10))
    multiStore.apply(event: .runStarted(ConsoleRun(id: "r", agentType: "PM", status: "IN_PROGRESS", parentId: nil, startedAt: "t", finishedAt: nil)))
    t.expectEqual(multiStore.pendingCommands.first(where: { $0.id == older })?.phase, .running, "오래된 것 바인딩")
    t.expectEqual(multiStore.pendingCommands.first(where: { $0.id == newer })?.phase, .sent, "새 것 미바인딩 유지")

    // 타임아웃: 60초 이상 .sent → .failed
    let timeoutStore = ConsoleStore()
    let tid = timeoutStore.enqueueCommand(text: "x", agentTypeHint: "PM", sentAt: base)
    timeoutStore.expireStalePendings(now: base.addingTimeInterval(61), timeout: 60)
    t.expectEqual(timeoutStore.pendingCommands.first?.phase, .failed, "타임아웃 → failed")

    // markCommandFailed / removeCommand
    let opStore = ConsoleStore()
    let oid = opStore.enqueueCommand(text: "y", agentTypeHint: nil, sentAt: base)
    opStore.markCommandFailed(id: oid)
    t.expectEqual(opStore.pendingCommands.first?.phase, .failed, "markCommandFailed")
    opStore.removeCommand(id: oid)
    t.expectEqual(opStore.pendingCommands.count, 0, "removeCommand")

    // 매칭 안 되는 run.started(힌트 다르고 힌트없음 없음) → pending 불변
    let noMatchStore = ConsoleStore()
    _ = noMatchStore.enqueueCommand(text: "z", agentTypeHint: "PM", sentAt: base)
    noMatchStore.apply(event: .runStarted(ConsoleRun(id: "r2", agentType: "BE", status: "IN_PROGRESS", parentId: nil, startedAt: "t", finishedAt: nil)))
    t.expectEqual(noMatchStore.pendingCommands.first?.phase, .sent, "미매칭 시 sent 유지")

    // command.rejected 는 commandId 가 일치하는 pending 만 실패 처리하고 이유를 기록
    let rejectedStore = ConsoleStore()
    let rejectedId = rejectedStore.enqueueCommand(text: "리뷰", agentTypeHint: nil, sentAt: base)
    let untouchedId = rejectedStore.enqueueCommand(text: "다른 지시", agentTypeHint: nil, sentAt: base)
    rejectedStore.apply(
        event: .commandRejected(commandId: rejectedId.uuidString, reason: "PR 없음")
    )
    t.expectEqual(
        rejectedStore.pendingCommands.first(where: { $0.id == rejectedId })?.phase,
        .failed,
        "command.rejected → failed"
    )
    t.expectEqual(
        rejectedStore.pendingCommands.first(where: { $0.id == rejectedId })?.reason,
        "PR 없음",
        "command.rejected reason 기록"
    )
    t.expectEqual(
        rejectedStore.pendingCommands.first(where: { $0.id == untouchedId })?.phase,
        .sent,
        "다른 pending 불변"
    )

    // command.info 는 안내만 기록하고 기존 phase 를 유지
    let infoStore = ConsoleStore()
    let infoId = infoStore.enqueueCommand(text: "리뷰", agentTypeHint: nil, sentAt: base)
    infoStore.apply(
        event: .commandInfo(commandId: infoId.uuidString, message: "최근 open PR 자동 선택")
    )
    t.expectEqual(infoStore.pendingCommands.first?.phase, .sent, "command.info phase 유지")
    t.expectEqual(
        infoStore.pendingCommands.first?.reason,
        "최근 open PR 자동 선택",
        "command.info message 기록"
    )

    // 미지 commandId 는 pending 목록을 변경하지 않음
    let unknownCommandStore = ConsoleStore()
    let knownId = unknownCommandStore.enqueueCommand(text: "리뷰", agentTypeHint: nil, sentAt: base)
    unknownCommandStore.apply(
        event: .commandRejected(commandId: UUID().uuidString, reason: "무시할 실패")
    )
    t.expectEqual(unknownCommandStore.pendingCommands.first?.id, knownId, "기존 pending 유지")
    t.expectEqual(unknownCommandStore.pendingCommands.first?.phase, .sent, "미지 commandId 무시")
    t.expectNil(unknownCommandStore.pendingCommands.first?.reason, "미지 commandId reason 미기록")

    _ = tid
    _ = cmdId

    // apply(event:) 는 처리한 이벤트를 eventStream 으로 방출한다
    let emitStore = ConsoleStore()
    emitStore.apply(snapshot: ConsoleSnapshot(
        agents: [ConsoleAgent(agentType: "PM", displayName: "PM", slashCommands: [], description: "", state: .waiting, bubble: "")],
        runs: [], approvals: [], sessions: [], serverTime: "t"))
    var receivedStateChange = false
    let cancellable = emitStore.eventStream.sink { event in
        if case .stateChanged(let agentType, _) = event, agentType == "PM" {
            receivedStateChange = true
        }
    }
    emitStore.apply(event: .stateChanged(agentType: "PM", state: .inProgress))
    t.expect(receivedStateChange, "apply(event:) 가 eventStream 으로 방출")
    cancellable.cancel()
}
