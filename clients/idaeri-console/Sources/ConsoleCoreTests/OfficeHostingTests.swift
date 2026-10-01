import Foundation

@testable import ConsoleCore

/// 3D 오피스 호스팅 경계 — 앱이 화면에 밀어 주는 메시지 모양과, 화면이 요청한 파일 경로의 루트 가두기.
func runOfficeHostingTests(_ t: TestRunner) {
    t.suite("OfficeHosting")

    // 스냅샷 메시지는 화면(`live.js` applySnapshot)이 읽는 필드를 백엔드 응답과 같은 이름·형식으로 싣는다.
    // 날짜가 숫자(기준 시각 초)로 바뀌면 `Date.parse` 가 NaN 을 내고 방치 단계가 전부 최고로 뜬다.
    do {
        let json = """
        {"agents":[{"agentType":"PM","displayName":"PM","slashCommands":[],"description":"","state":"AWAITING_APPROVAL","bubble":"결재 대기","department":"planning"}],"runs":[],"approvals":[{"id":"a1","agentType":"PM","title":"t","createdAt":"2026-09-30T01:00:00.000Z","expiresAt":"2026-09-30T01:30:00.000Z"}],"sessions":[{"sessionId":"s","pid":1,"source":"claude","name":"personal_agents","cwd":"/x","state":"active","startedAt":"2026-09-30T00:00:00.000Z","lastActivityAt":null}],"serverTime":"2026-09-30T01:05:00.000Z"}
        """.data(using: .utf8)!
        let snapshot = try JSONDecoder().decode(ConsoleSnapshot.self, from: json)
        guard let message = officeHostedSnapshotMessage(snapshot),
            let object = try JSONSerialization.jsonObject(with: Data(message.utf8)) as? [String: Any],
            let data = object["data"] as? [String: Any]
        else {
            t.fail("스냅샷 메시지를 만들거나 읽지 못했다")
            return
        }
        t.expectEqual(object["type"] as? String, "snapshot", "메시지 종류")
        let agent = (data["agents"] as? [[String: Any]])?.first
        t.expectEqual(agent?["agentType"] as? String, "PM", "agentType")
        t.expectEqual(agent?["state"] as? String, "AWAITING_APPROVAL", "상태는 백엔드 문자열 그대로")
        t.expectEqual(agent?["bubble"] as? String, "결재 대기", "말풍선")
        let approval = (data["approvals"] as? [[String: Any]])?.first
        t.expectEqual(approval?["createdAt"] as? String, "2026-09-30T01:00:00.000Z", "날짜는 문자열 그대로")
        t.expectEqual(approval?["agentType"] as? String, "PM", "승인 담당자")
        let session = (data["sessions"] as? [[String: Any]])?.first
        t.expectEqual(session?["name"] as? String, "personal_agents", "세션 이름")
        t.expectEqual(session?["state"] as? String, "active", "세션 상태")
    } catch {
        t.fail("스냅샷 픽스처 디코딩 실패: \(error)")
    }

    // 이벤트는 상태 변화만 옮긴다 — 화면이 이벤트에서 쓰는 것이 그것뿐이다.
    do {
        let changed = ConsoleEvent.stateChanged(agentType: "PM", state: .inProgress, bubble: "일하는 중…")
        let message = officeHostedEventMessage(changed) ?? ""
        let object = try JSONSerialization.jsonObject(with: Data(message.utf8)) as? [String: Any]
        let data = object?["data"] as? [String: Any]
        t.expectEqual(object?["type"] as? String, "event", "메시지 종류")
        t.expectEqual(data?["agentType"] as? String, "PM", "agentType")
        t.expectEqual(data?["state"] as? String, "IN_PROGRESS", "상태 문자열")
        t.expectEqual(data?["bubble"] as? String, "일하는 중…", "말풍선")
        t.expect(
            officeHostedEventMessage(.sessionClosed(sessionId: "s")) == nil,
            "상태 변화가 아닌 이벤트는 보내지 않는다(스냅샷이 메운다)"
        )
    } catch {
        t.fail("이벤트 메시지를 읽지 못했다: \(error)")
    }

    // 연출 지시는 인계·회의·거절만 옮긴다 — 화면(`live.js` performIntent)이 읽는 이름 그대로.
    do {
        let handoff = officeHostedIntentMessage(.handoff(from: "PM", to: "CEO")) ?? ""
        let object = try JSONSerialization.jsonObject(with: Data(handoff.utf8)) as? [String: Any]
        let data = object?["data"] as? [String: Any]
        t.expectEqual(object?["type"] as? String, "intent", "메시지 종류")
        t.expectEqual(data?["kind"] as? String, "handoff", "인계")
        t.expectEqual(data?["from"] as? String, "PM", "넘기는 사람")
        t.expectEqual(data?["to"] as? String, "CEO", "받는 사람")
        let reject = officeHostedIntentMessage(.reject(agentType: "PM")) ?? ""
        let rejected = (try JSONSerialization.jsonObject(with: Data(reject.utf8)) as? [String: Any])?["data"] as? [String: Any]
        t.expectEqual(rejected?["kind"] as? String, "reject", "거절")
        t.expectEqual(rejected?["agentType"] as? String, "PM", "거절당한 사람")
        // 회의는 참석자 순서를 그대로 옮긴다 — 화면은 이 순서대로 회의 자리를 채운다(2D `holdMeeting`).
        let meeting = officeHostedIntentMessage(
            .meeting(agentTypes: ["WORK_REVIEWER", "PO_SHADOW", "PO_EVAL"], thenWorking: "PO_EVAL")
        ) ?? ""
        let met = (try JSONSerialization.jsonObject(with: Data(meeting.utf8)) as? [String: Any])?["data"] as? [String: Any]
        t.expectEqual(met?["kind"] as? String, "meeting", "회의")
        t.expectEqual(met?["agentTypes"] as? [String], ["WORK_REVIEWER", "PO_SHADOW", "PO_EVAL"], "참석자")
        t.expectEqual(met?["thenWorking"] as? String, "PO_EVAL", "회의 뒤 일을 시작할 사람")
        t.expect(met?["from"] == nil && met?["agentType"] == nil, "회의에는 인계·거절 필드를 싣지 않는다")
        t.expect(
            officeHostedIntentMessage(.working(agentType: "PM")) == nil,
            "나머지 연출은 보내지 않는다(이벤트·스냅샷이 옮긴다)"
        )
    } catch {
        t.fail("연출 지시 메시지를 읽지 못했다: \(error)")
    }

    // 지시 단계는 사람별로 가장 최근 지시의 것 하나. 담당자가 안 정해진 지시는 빠진다.
    do {
        let early = Date(timeIntervalSince1970: 100)
        let commands = [
            PendingCommand(id: UUID(), text: "a", agentTypeHint: "PM", sentAt: early, phase: .done),
            PendingCommand(id: UUID(), text: "b", agentTypeHint: "PM", sentAt: early.addingTimeInterval(5), phase: .sent),
            PendingCommand(id: UUID(), text: "c", agentTypeHint: nil, sentAt: early, phase: .sent),
        ]
        let message = officeHostedPendingMessage(commands) ?? ""
        let object = try JSONSerialization.jsonObject(with: Data(message.utf8)) as? [String: Any]
        let data = object?["data"] as? [String: String]
        t.expectEqual(object?["type"] as? String, "pending", "메시지 종류")
        t.expectEqual(data ?? [:], ["PM": "sent"], "가장 최근 지시의 단계만")
        let empty = officeHostedPendingMessage([]) ?? ""
        t.expect(empty.contains(#""data":{}"#), "지시가 없으면 빈 묶음 — 화면이 점을 지운다")
    } catch {
        t.fail("지시 단계 메시지를 읽지 못했다: \(error)")
    }

    // 경로는 루트 안에 가둔다 — 이 핸들러는 앱 권한으로 디스크를 읽는 입구다.
    let root = URL(fileURLWithPath: "/tmp/office-web")
    t.expectEqual(
        officeWebResourceURL(root: root, requestPath: "/")?.path, "/tmp/office-web/index.html",
        "빈 경로는 index.html"
    )
    t.expectEqual(
        officeWebResourceURL(root: root, requestPath: "/three/renderer3d.js")?.path,
        "/tmp/office-web/three/renderer3d.js", "하위 경로"
    )
    t.expect(officeWebResourceURL(root: root, requestPath: "/../secret") == nil, "상위로 나가는 경로")
    t.expect(
        officeWebResourceURL(root: root, requestPath: "/three/../../etc/passwd") == nil,
        "중간에 끼운 .."
    )
    t.expect(officeWebResourceURL(root: root, requestPath: "/./index.html") == nil, "점 구성 요소")
    // URL 이 퍼센트 인코딩을 풀어 넘기므로 `%2e%2e` 는 `..` 로 들어온다 — 풀린 값으로도 막히는지.
    let encoded = URL(string: "idaeri-office://app/%2e%2e/secret")?.path ?? ""
    t.expect(officeWebResourceURL(root: root, requestPath: encoded) == nil, "퍼센트 인코딩된 ..")
    t.expectEqual(
        officeWebResourceURL(root: root, requestPath: "//vendor//three/three.module.js")?.path,
        "/tmp/office-web/vendor/three/three.module.js", "겹친 빗금은 접는다"
    )

    // 루트 안의 심볼릭 링크가 밖을 가리키면 따라가지 않는다.
    let fileManager = FileManager.default
    let sandbox = fileManager.temporaryDirectory.appendingPathComponent("office-hosting-\(UUID().uuidString)")
    let linkedRoot = sandbox.appendingPathComponent("office-web")
    let outside = sandbox.appendingPathComponent("outside.txt")
    do {
        try fileManager.createDirectory(at: linkedRoot, withIntermediateDirectories: true)
        try Data("x".utf8).write(to: outside)
        try Data("x".utf8).write(to: linkedRoot.appendingPathComponent("inside.js"))
        try fileManager.createSymbolicLink(at: linkedRoot.appendingPathComponent("leak.js"), withDestinationURL: outside)
        t.expect(officeWebResourceURL(root: linkedRoot, requestPath: "/leak.js") == nil, "밖을 가리키는 심볼릭 링크")
        t.expect(officeWebResourceURL(root: linkedRoot, requestPath: "/inside.js") != nil, "루트 안 실제 파일은 통과")
    } catch {
        t.fail("심볼릭 링크 픽스처 준비 실패: \(error)")
    }
    try? fileManager.removeItem(at: sandbox)

    t.expectEqual(officeWebMimeType(for: URL(fileURLWithPath: "/a/live.js")), "text/javascript", "모듈 MIME")
    t.expectEqual(officeWebMimeType(for: URL(fileURLWithPath: "/a/index.html")), "text/html", "문서 MIME")
}
