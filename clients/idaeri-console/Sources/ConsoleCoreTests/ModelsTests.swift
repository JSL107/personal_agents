import Foundation

@testable import ConsoleCore

/// 백엔드 계약(`src/console/domain/console.type.ts`)을 미러링한 Codable 모델의 디코딩 검증.
/// JSON 픽스처는 A1 응답 형태를 그대로 옮긴 것으로, 계약이 바뀌면 여기서 먼저 깨진다.
func runModelsTests(_ t: TestRunner) {
    t.suite("Models")

    // 스냅샷 전체 디코딩 + 상태 문자열 매핑
    do {
        let json = """
        {"agents":[{"agentType":"PM","displayName":"PM","slashCommands":["/today"],"description":"","state":"IN_PROGRESS","bubble":"일하는 중…"}],"runs":[],"approvals":[],"sessions":[],"serverTime":"2026-07-27T00:00:00Z"}
        """.data(using: .utf8)!
        let snapshot = try JSONDecoder().decode(ConsoleSnapshot.self, from: json)
        t.expectEqual(snapshot.agents.count, 1, "agents 개수")
        t.expectEqual(snapshot.agents.first?.agentType, "PM", "agentType")
        t.expectEqual(snapshot.agents.first?.state, .inProgress, "state 디코딩")
        t.expectEqual(snapshot.agents.first?.slashCommands ?? [], ["/today"], "slashCommands")
        t.expectEqual(snapshot.serverTime, "2026-07-27T00:00:00Z", "serverTime")
    } catch {
        t.fail("스냅샷 디코딩 실패: \(error)")
    }

    // Run 의 nullable 필드(parentId / finishedAt)가 null 이면 nil
    do {
        let json = """
        {"id":"r1","agentType":"BE","status":"IN_PROGRESS","parentId":null,"startedAt":"2026-07-27T00:00:00Z","finishedAt":null}
        """.data(using: .utf8)!
        let run = try JSONDecoder().decode(ConsoleRun.self, from: json)
        t.expectEqual(run.agentType, "BE", "run.agentType")
        t.expectNil(run.parentId, "run.parentId 는 null")
        t.expectNil(run.finishedAt, "run.finishedAt 는 null")
    } catch {
        t.fail("Run 디코딩 실패: \(error)")
    }

    // Approval 의 agentType 은 v1 에서 null 가능
    do {
        let json = """
        {"id":"p1","agentType":null,"title":"발행 승인","createdAt":"2026-07-27T00:00:00Z"}
        """.data(using: .utf8)!
        let approval = try JSONDecoder().decode(ConsoleApproval.self, from: json)
        t.expectNil(approval.agentType, "approval.agentType 는 null")
        t.expectEqual(approval.title, "발행 승인", "approval.title")
    } catch {
        t.fail("Approval 디코딩 실패: \(error)")
    }

    // 상태 5종이 백엔드 rawValue 로 전부 디코딩되는지
    let statePairs: [(String, ConsoleAgentState)] = [
        ("COMPLETED", .completed),
        ("IN_PROGRESS", .inProgress),
        ("AWAITING_APPROVAL", .awaitingApproval),
        ("AWAITING_INTEGRATION", .awaitingIntegration),
        ("WAITING", .waiting),
    ]
    for (raw, expected) in statePairs {
        do {
            let json = "\"\(raw)\"".data(using: .utf8)!
            let state = try JSONDecoder().decode(ConsoleAgentState.self, from: json)
            t.expectEqual(state, expected, "\(raw) 상태 디코딩")
        } catch {
            t.fail("\(raw) 상태 디코딩 실패: \(error)")
        }
    }

    // ConsoleEvent 유니온 — state.changed
    do {
        let json = """
        {"type":"state.changed","agentType":"PM","state":"COMPLETED"}
        """.data(using: .utf8)!
        let event = try JSONDecoder().decode(ConsoleEvent.self, from: json)
        if case let .stateChanged(agentType, state) = event {
            t.expectEqual(agentType, "PM", "state.changed agentType")
            t.expectEqual(state, .completed, "state.changed state")
        } else {
            t.fail("state.changed 로 디코딩되어야 함")
        }
    } catch {
        t.fail("state.changed 디코딩 실패: \(error)")
    }

    // ConsoleEvent 유니온 — run.started
    do {
        let json = """
        {"type":"run.started","run":{"id":"r1","agentType":"PM","status":"IN_PROGRESS","parentId":null,"startedAt":"2026-07-27T00:00:00Z","finishedAt":null}}
        """.data(using: .utf8)!
        let event = try JSONDecoder().decode(ConsoleEvent.self, from: json)
        if case let .runStarted(run) = event {
            t.expectEqual(run.id, "r1", "run.started run.id")
        } else {
            t.fail("run.started 로 디코딩되어야 함")
        }
    } catch {
        t.fail("run.started 디코딩 실패: \(error)")
    }

    // ConsoleEvent 유니온 — approval.opened
    do {
        let json = """
        {"type":"approval.opened","approval":{"id":"p1","agentType":null,"title":"발행 승인","createdAt":"2026-07-27T00:00:00Z"}}
        """.data(using: .utf8)!
        let event = try JSONDecoder().decode(ConsoleEvent.self, from: json)
        if case let .approvalOpened(approval) = event {
            t.expectEqual(approval.id, "p1", "approval.opened approval.id")
        } else {
            t.fail("approval.opened 로 디코딩되어야 함")
        }
    } catch {
        t.fail("approval.opened 디코딩 실패: \(error)")
    }

    // 알 수 없는 이벤트 타입은 디코딩 에러
    t.expectThrows("알 수 없는 이벤트 타입은 throw") {
        let json = """
        {"type":"totally.unknown"}
        """.data(using: .utf8)!
        _ = try JSONDecoder().decode(ConsoleEvent.self, from: json)
    }
}
