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
        bubble: "업무 대기중",
        department: Department.planning.rawValue
    )
    let be = ConsoleAgent(
        agentType: "BE",
        displayName: "BE",
        slashCommands: ["/plan-task"],
        description: "",
        state: .waiting,
        bubble: "업무 대기중",
        department: Department.engineering.rawValue
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

    // 부서도 유지된다. 상태 변경은 에이전트를 새로 만들어 갈아 끼우는데, 그때 필드를 손으로
    // 나열하면 새 필드가 조용히 빠진다 — 부서가 빠지면 상태가 바뀐 사람이 자기 방에서
    // 내부방으로 순간이동한다. 기본값이 있어서 컴파일러가 잡아 주지 않으므로 여기서 못 박는다.
    t.expectEqual(
        store.agents.first(where: { $0.agentType == "PM" })?.resolvedDepartment, .planning,
        "상태 변경 후에도 부서 유지"
    )

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
        createdAt: "2026-07-27T00:03:00Z",
        expiresAt: "2026-07-27T01:03:00Z"
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

    // command.answered 는 제안 상태와 안내 본문을 함께 기록
    let answeredStore = ConsoleStore()
    let answeredId = answeredStore.enqueueCommand(text: "뭘 시킬까?", agentTypeHint: nil, sentAt: base)
    answeredStore.apply(
        event: .commandAnswered(commandId: answeredId.uuidString, message: "1. PM — 마지막 성공 2일 전")
    )
    t.expectEqual(answeredStore.pendingCommands.first?.phase, .answered, "command.answered → answered")
    t.expectEqual(
        answeredStore.pendingCommands.first?.reason,
        "1. PM — 마지막 성공 2일 전",
        "command.answered message 기록"
    )

    // 대조군: 오래된 제안은 실행 무응답이 아니므로 expireStalePendings 가 실패로 강등하지 않음
    answeredStore.expireStalePendings(now: base.addingTimeInterval(61), timeout: 60)
    t.expectEqual(
        answeredStore.pendingCommands.first?.phase,
        .answered,
        "command.answered 는 timeout 뒤에도 answered 유지"
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

    runAcknowledgeCompletionTests(t)
}

/// 완료 수기 확인 — 서버는 최근 종료 창(60분) 동안 계속 완료를 보내주므로, 확인한 완료가
/// 스냅샷마다 되살아나지 않아야 한다. 반대로 새 완료는 확인 기록에 가려지지 않아야 한다.
private func runAcknowledgeCompletionTests(_ t: TestRunner) {
    t.suite("ConsoleStore.acknowledgeCompletion")

    let firstRunId = "101"
    let secondRunId = "102"

    func completedSnapshot(runId: String?) -> ConsoleSnapshot {
        ConsoleSnapshot(
            agents: [
                ConsoleAgent(
                    agentType: "CTO",
                    displayName: "CTO",
                    slashCommands: ["/assign"],
                    description: "",
                    state: .completed,
                    bubble: "완료했어요!",
                    lastFinishedRunId: runId
                )
            ],
            runs: [],
            approvals: [],
            sessions: [],
            serverTime: "2026-08-04T05:30:00Z"
        )
    }

    // 확인하면 즉시 대기로 내려가고 말풍선도 대기 문구로 바뀐다
    let store = ConsoleStore()
    store.apply(snapshot: completedSnapshot(runId: firstRunId))
    t.expectEqual(store.agents.first?.state, .completed, "확인 전에는 완료")
    store.acknowledgeCompletion(agentType: "CTO")
    t.expectEqual(store.agents.first?.state, .waiting, "확인하면 대기로 내려감")
    t.expectEqual(store.agents.first?.bubble, "업무 대기중", "확인 후 말풍선도 대기 문구")

    // 서버가 같은 완료를 다시 보내도(창 안이라 계속 온다) 되살아나지 않는다
    store.apply(snapshot: completedSnapshot(runId: firstRunId))
    t.expectEqual(store.agents.first?.state, .waiting, "같은 완료는 스냅샷에서도 대기 유지")

    // 새 런이 끝나 런 id 가 바뀌면 다시 완료로 보인다
    store.apply(snapshot: completedSnapshot(runId: secondRunId))
    t.expectEqual(store.agents.first?.state, .completed, "새 완료는 다시 표시")

    // 라이브 완료를 SSE 로 받은 직후 확인하면, 뒤이어 오는 스냅샷에서도 되살아나지 않아야 한다.
    // 식별자를 종료 시각으로 두면 여기서 깨진다 — SSE 의 finishedAt 은 DB 의 endedAt 과 따로
    // 생성돼 같은 런인데도 값이 어긋나고, 스냅샷이 DB 값을 주면 "다른 완료" 로 오인된다.
    // 런 id 는 양쪽이 같은 값을 실어 보내므로 그 경로가 막힌다.
    let sseThenSnapshotStore = ConsoleStore()
    sseThenSnapshotStore.apply(snapshot: completedSnapshot(runId: nil))
    sseThenSnapshotStore.apply(
        event: .runFinished(
            ConsoleRun(
                id: firstRunId,
                agentType: "CTO",
                status: "SUCCEEDED",
                parentId: nil,
                startedAt: "2026-08-04T04:59:00Z",
                // SSE 가 실어 보내는 종료 시각. DB 에 기록된 값과 밀리초 단위로 다르다.
                finishedAt: "2026-08-04T05:00:00.150Z"
            )
        )
    )
    sseThenSnapshotStore.apply(event: .stateChanged(agentType: "CTO", state: .completed))
    t.expectEqual(sseThenSnapshotStore.agents.first?.state, .completed, "SSE 완료 표시")
    sseThenSnapshotStore.acknowledgeCompletion(agentType: "CTO")
    t.expectEqual(sseThenSnapshotStore.agents.first?.state, .waiting, "라이브 완료 확인 직후 대기")
    // 30초 뒤 스냅샷 — 같은 런이지만 서버는 DB 종료 시각으로 계산해 보낸다
    sseThenSnapshotStore.apply(snapshot: completedSnapshot(runId: firstRunId))
    t.expectEqual(
        sseThenSnapshotStore.agents.first?.state,
        .waiting,
        "라이브로 확인한 완료가 다음 스냅샷에서 되살아나지 않음"
    )

    // run.finished 가 런 id 를 갱신하므로, 뒤따르는 state.changed 는 확인 기록에 가려지지 않는다
    // (백엔드는 두 이벤트를 항상 이 순서로 쌍 발행한다. 스냅샷 30초를 기다리지 않아야 한다.)
    let liveStore = ConsoleStore()
    liveStore.apply(snapshot: completedSnapshot(runId: firstRunId))
    liveStore.acknowledgeCompletion(agentType: "CTO")
    t.expectEqual(liveStore.agents.first?.state, .waiting, "확인 직후 대기")
    liveStore.apply(
        event: .runFinished(
            ConsoleRun(
                id: secondRunId,
                agentType: "CTO",
                status: "SUCCEEDED",
                parentId: nil,
                startedAt: "2026-08-04T04:59:00Z",
                finishedAt: "2026-08-04T05:00:00Z"
            )
        )
    )
    liveStore.apply(event: .stateChanged(agentType: "CTO", state: .completed))
    t.expectEqual(liveStore.agents.first?.state, .completed, "SSE 로 온 새 완료는 즉시 표시")

    // 런 id 를 모르는 완료는 확인해도 판정 키가 없어 그대로 둔다(확인 버튼도 숨는 조건)
    let unknownStore = ConsoleStore()
    unknownStore.apply(snapshot: completedSnapshot(runId: nil))
    unknownStore.acknowledgeCompletion(agentType: "CTO")
    t.expectEqual(unknownStore.agents.first?.state, .completed, "런 id 없으면 확인 무시")

    // 완료가 아닌 상태는 확인 대상이 아니다
    let waitingStore = ConsoleStore()
    waitingStore.apply(
        snapshot: ConsoleSnapshot(
            agents: [
                ConsoleAgent(
                    agentType: "CTO",
                    displayName: "CTO",
                    slashCommands: [],
                    description: "",
                    state: .inProgress,
                    bubble: "일하는 중…",
                    lastFinishedRunId: firstRunId
                )
            ],
            runs: [], approvals: [], sessions: [], serverTime: "t"
        )
    )
    waitingStore.acknowledgeCompletion(agentType: "CTO")
    t.expectEqual(waitingStore.agents.first?.state, .inProgress, "진행 중은 확인 무시")

    // 미지의 agentType 은 무시(크래시 없음)
    let ghostStore = ConsoleStore()
    ghostStore.apply(snapshot: completedSnapshot(runId: firstRunId))
    ghostStore.acknowledgeCompletion(agentType: "GHOST")
    t.expectEqual(ghostStore.agents.first?.state, .completed, "미지 agentType 무시")
}
