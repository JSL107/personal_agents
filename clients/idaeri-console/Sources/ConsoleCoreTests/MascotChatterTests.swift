import Foundation

@testable import ConsoleCore

func runMascotChatterTests(_ runner: TestRunner) {
    runner.suite("Mascot chatter conversation")
    let now = Date(timeIntervalSinceReferenceDate: 1_000_000)
    let user = MascotTurn(role: .user, text: "안녕", at: now)
    let old = MascotTurn(role: .usagi, text: "옛 답", at: now.addingTimeInterval(-1_801))
    runner.expectEqual(mascotAppendTurn([old], user, now: now), [user], "30분 지난 마지막 turn 은 지운다")
    let recent = MascotTurn(role: .usagi, text: "방금 답", at: now.addingTimeInterval(-1_800))
    runner.expectEqual(mascotAppendTurn([recent], user, now: now), [recent, user], "30분 경계는 유지")
    let turns = (0..<10).map { index in
        MascotTurn(role: .user, text: "\(index)", at: now.addingTimeInterval(Double(index - 10)))
    }
    runner.expectEqual(mascotAppendTurn(turns, user, now: now), Array(turns.dropFirst()) + [user], "최대 10개")
    runner.expectEqual(mascotLiveTurns([recent], now: now), [recent], "30분 경계는 유효")
    runner.expectEqual(mascotLiveTurns([old], now: now), [], "30분 초과는 만료")

    runner.suite("Mascot chatter decoding")
    let withoutSuggestion = try! JSONDecoder().decode(
        MascotChatterLine.self,
        from: Data(#"{"line":"오늘도 차근차근 하자","suggestion":null,"asks":false}"#.utf8)
    )
    runner.expectEqual(withoutSuggestion.line, "오늘도 차근차근 하자", "본문")
    runner.expectNil(withoutSuggestion.suggestion, "제안 없음")
    let withSuggestion = try! JSONDecoder().decode(
        MascotChatterLine.self,
        from: Data(#"{"line":"계획 세울까?","suggestion":{"agentType":"PM","displayName":"PM","reason":"할 일 정리"},"asks":true}"#.utf8)
    )
    runner.expectEqual(withSuggestion.suggestion?.agentType, "PM", "제안 타입")
    runner.expectEqual(withSuggestion.suggestion?.reason, "할 일 정리", "제안 이유")
    runner.expect(withSuggestion.asks, "질문 여부")

    runner.suite("Mascot chatter request")
    let request = try! buildMascotChatterRequest(
        baseURL: URL(string: "http://127.0.0.1:3002")!, declinedAgentTypes: ["PM"], token: "secret"
    )
    runner.expectEqual(request.httpMethod, "POST", "method")
    runner.expectEqual(request.url?.path, "/v1/console/mascot/chatter", "경로")
    runner.expectEqual(request.value(forHTTPHeaderField: "x-console-token"), "secret", "토큰")
    let body = try! JSONDecoder().decode([String: [String]].self, from: request.httpBody!)
    runner.expectEqual(body["declinedAgentTypes"], ["PM"], "거절한 후보")
}
