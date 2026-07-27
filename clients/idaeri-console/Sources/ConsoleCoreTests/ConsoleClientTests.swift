import Foundation

@testable import ConsoleCore

/// POST 요청 빌더가 method/헤더/경로/body 를 계약대로 만드는지 검증(네트워크 없이 순수 함수).
func runConsoleClientTests(_ t: TestRunner) {
    t.suite("ConsoleClient")

    let base = URL(string: "http://127.0.0.1:3002")!

    // command: POST + JSON body + 토큰 헤더
    let commandRequest = try! buildCommandRequest(
        baseURL: base,
        body: CommandRequest(text: "오늘 계획", agentTypeHint: "PM"),
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

    // 토큰 미설정이면 헤더 없음
    let noToken = try! buildCommandRequest(
        baseURL: base,
        body: CommandRequest(text: "x", agentTypeHint: nil),
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
    let cancelRequest = buildApprovalRequest(baseURL: base, previewId: "p2", action: "cancel", token: nil)
    t.expectEqual(
        cancelRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/approvals/p2/cancel",
        "cancel 경로"
    )
}

/// 테스트 전용 — 인코딩된 body 를 되읽기 위한 미러 타입.
private struct CommandRequestEcho: Decodable {
    let text: String
    let agentTypeHint: String?
}
