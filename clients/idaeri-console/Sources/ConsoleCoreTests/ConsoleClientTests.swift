import Foundation

@testable import ConsoleCore

/// POST 요청 빌더가 method/헤더/경로/body 를 계약대로 만드는지 검증(네트워크 없이 순수 함수).
func runConsoleClientTests(_ t: TestRunner) {
    t.suite("ConsoleClient")

    let base = URL(string: "http://127.0.0.1:3002")!

    // command: POST + JSON body + 토큰 헤더
    let commandRequest = try! buildCommandRequest(
        baseURL: base,
        body: CommandRequest(text: "오늘 계획", agentTypeHint: "PM", commandId: "command-123"),
        token: "secret"
    )
    t.expectEqual(commandRequest.httpMethod, "POST", "command method")
    t.expectEqual(
        commandRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/command",
        "command 경로"
    )
    t.expectEqual(
        commandRequest.value(forHTTPHeaderField: "Content-Type"),
        "application/json",
        "command content-type"
    )
    t.expectEqual(
        commandRequest.value(forHTTPHeaderField: "x-console-token"),
        "secret",
        "command 토큰 헤더"
    )
    let decoded = try! JSONDecoder().decode(
        CommandRequestEcho.self,
        from: commandRequest.httpBody ?? Data()
    )
    t.expectEqual(decoded.text, "오늘 계획", "command body text")
    t.expectEqual(decoded.agentTypeHint, "PM", "command body hint")
    t.expectEqual(decoded.commandId, "command-123", "command body commandId")

    // 토큰 미설정이면 헤더 없음
    let noToken = try! buildCommandRequest(
        baseURL: base,
        body: CommandRequest(text: "x", agentTypeHint: nil, commandId: "command-456"),
        token: nil
    )
    t.expectNil(noToken.value(forHTTPHeaderField: "x-console-token"), "토큰 미설정 시 헤더 없음")

    // approval: 경로에 action 반영
    let applyRequest = buildApprovalRequest(baseURL: base, previewId: "p1", action: "apply", token: nil)
    t.expectEqual(applyRequest.httpMethod, "POST", "apply method")
    t.expectEqual(
        applyRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/approvals/p1/apply",
        "apply 경로"
    )
    // 승인 반영은 백엔드가 codex·Notion 을 왕복해 2분까지 걸린다. 기본 60초로 두면 정상
    // 처리 중인 요청을 클라이언트가 먼저 포기한다.
    t.expectEqual(applyRequest.timeoutInterval, 180, "apply 타임아웃 여유")

    // 타임아웃은 "답을 못 들었다" 이고 서버는 계속 돌고 있을 수 있다 — 상태를 받은 실패와
    // 같게 다루면 아직 진행 중인 카드를 되살려 재클릭을 부른다.
    t.expectEqual(isRequestTimeout(URLError(.timedOut)), true, "타임아웃 식별")
    t.expectEqual(isRequestTimeout(URLError(.cannotConnectToHost)), false, "연결 실패는 타임아웃이 아니다")
    t.expectEqual(isRequestTimeout(ConsoleClientError.badStatus(412)), false, "상태를 받은 실패는 타임아웃이 아니다")

    let cancelRequest = buildApprovalRequest(baseURL: base, previewId: "p2", action: "cancel", token: nil)
    t.expectEqual(
        cancelRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/approvals/p2/cancel",
        "cancel 경로"
    )

    // inject: POST + JSON body + 경로에 sessionId
    let injectRequest = try! buildInjectRequest(
        baseURL: base,
        sessionId: "sess-1",
        text: "테스트 고쳐",
        token: "secret"
    )
    t.expectEqual(injectRequest.httpMethod, "POST", "inject method")
    t.expectEqual(
        injectRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/sessions/sess-1/inject",
        "inject 경로"
    )
    t.expectEqual(
        injectRequest.value(forHTTPHeaderField: "x-console-token"),
        "secret",
        "inject 토큰 헤더"
    )
    let injectEcho = try! JSONDecoder().decode(
        InjectBodyEcho.self,
        from: injectRequest.httpBody ?? Data()
    )
    t.expectEqual(injectEcho.text, "테스트 고쳐", "inject body text")

    // 상태코드 → 결과 매핑
    t.expectEqual(injectOutcome(forStatus: 202), .queued, "202 = queued")
    t.expectEqual(
        injectOutcome(forStatus: 404),
        .failed(reason: "세션을 찾을 수 없음"),
        "404 매핑"
    )
    t.expectEqual(
        injectOutcome(forStatus: 400),
        .failed(reason: "빈 지시"),
        "400 매핑"
    )
}

/// 테스트 전용 — 인코딩된 body 를 되읽기 위한 미러 타입.
private struct CommandRequestEcho: Decodable {
    let text: String
    let agentTypeHint: String?
    let commandId: String
}

private struct InjectBodyEcho: Decodable {
    let text: String
}
