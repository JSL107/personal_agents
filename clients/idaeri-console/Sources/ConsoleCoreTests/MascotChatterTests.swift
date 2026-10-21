import Foundation

@testable import ConsoleCore

private extension MascotTalkState {
    init(
        copying source: MascotTalkState, lastSpokeAt: Date? = nil, userIdleSeconds: TimeInterval? = nil,
        awaySince: Date? = nil, finishedSinceLastTalk: Int? = nil, longestRunningSeconds: TimeInterval? = nil,
        lastProgressAt: Date? = nil, mood: MascotMood? = nil, talkedToday: Int? = nil,
        idleChanceRoll: Double? = nil
    ) {
        self.init(
            lastSpokeAt: lastSpokeAt ?? source.lastSpokeAt,
            userIdleSeconds: userIdleSeconds ?? source.userIdleSeconds,
            awaySince: awaySince ?? source.awaySince,
            finishedSinceLastTalk: finishedSinceLastTalk ?? source.finishedSinceLastTalk,
            longestRunningSeconds: longestRunningSeconds ?? source.longestRunningSeconds,
            lastProgressAt: lastProgressAt ?? source.lastProgressAt,
            mood: mood ?? source.mood, talkedToday: talkedToday ?? source.talkedToday,
            idleChanceRoll: idleChanceRoll ?? source.idleChanceRoll
        )
    }
}

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
        from: Data(#"{"chatterId":null,"line":"오늘도 차근차근 하자","suggestion":null,"asks":false}"#.utf8)
    )
    runner.expectNil(withoutSuggestion.chatterId, "id 없음")
    runner.expectEqual(withoutSuggestion.line, "오늘도 차근차근 하자", "본문")
    runner.expectNil(withoutSuggestion.suggestion, "제안 없음")
    runner.expectEqual(withoutSuggestion.hasEvents, false, "예전 응답에는 끝난 일 없음")
    let withSuggestion = try! JSONDecoder().decode(
        MascotChatterLine.self,
        from: Data(#"{"chatterId":"chatter-1","line":"계획 세울까?","suggestion":{"agentType":"PM","displayName":"PM","reason":"할 일 정리"},"asks":true}"#.utf8)
    )
    runner.expectEqual(withSuggestion.chatterId, "chatter-1", "표시 확인 id")
    runner.expectEqual(withSuggestion.suggestion?.agentType, "PM", "제안 타입")
    runner.expectEqual(withSuggestion.suggestion?.reason, "할 일 정리", "제안 이유")
    runner.expect(withSuggestion.asks, "질문 여부")
    let withEvents = try! JSONDecoder().decode(
        MascotChatterLine.self,
        from: Data(#"{"chatterId":"chatter-2","line":"일이 끝났어","suggestion":null,"asks":false,"hasEvents":true}"#.utf8)
    )
    runner.expect(withEvents.hasEvents, "끝난 일이 있으면 보기 버튼을 띄운다")
    let emptyEvents = try! JSONDecoder().decode(
        MascotChatterLine.self,
        from: Data(#"{"chatterId":null,"line":null,"suggestion":null,"asks":false,"hasEvents":false,"reason":"NOTHING_TO_SAY"}"#.utf8)
    )
    runner.expectEqual(emptyEvents.reason, "NOTHING_TO_SAY", "말할 거리 없음 사유를 읽는다")
    runner.expectNil(withEvents.reason, "정상 응답에는 사유가 없어도 된다")

    runner.suite("Mascot empty events response")
    runner.expectEqual(
        mascotUnreportedFinishedCount(currentCount: 1, countAtRequest: 1), 0,
        "요청 전 내부 실행만 끝났으면 반복 EVENTS를 막는다"
    )
    runner.expectEqual(
        mascotUnreportedFinishedCount(currentCount: 3, countAtRequest: 1), 2,
        "응답을 기다리는 동안 끝난 두 실행은 다음 알림으로 남긴다"
    )

    runner.suite("Mascot chatter request")
    let request = try! buildMascotChatterRequest(
        baseURL: URL(string: "http://127.0.0.1:3002")!, trigger: .returning,
        since: Date(timeIntervalSince1970: 0), declinedAgentTypes: ["PM"], token: "secret"
    )
    runner.expectEqual(request.httpMethod, "POST", "method")
    runner.expectEqual(request.url?.path, "/v1/console/mascot/chatter", "경로")
    runner.expectEqual(request.value(forHTTPHeaderField: "x-console-token"), "secret", "토큰")
    let body = try! JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
    runner.expectEqual(body["declinedAgentTypes"] as? [String], ["PM"], "거절한 후보")
    runner.expectEqual(body["trigger"] as? String, "RETURN", "복귀 계기")
    runner.expectEqual(body["since"] as? String, "1970-01-01T00:00:00Z", "UTC ISO8601 시작 시각")

    runner.suite("Mascot talk trigger")
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let officeNow = calendar.date(from: DateComponents(year: 2026, month: 10, day: 21, hour: 12))!
    let state = MascotTalkState(
        lastSpokeAt: officeNow.addingTimeInterval(-600), userIdleSeconds: 0, awaySince: nil,
        finishedSinceLastTalk: 0, longestRunningSeconds: nil, lastProgressAt: nil,
        mood: .idle, talkedToday: 0, idleChanceRoll: 0
    )
    runner.expectEqual(mascotNextTalkTrigger(state: state, now: officeNow, calendar: calendar), .idle, "idle")
    runner.expectNil(mascotNextTalkTrigger(
        state: state, now: officeNow.addingTimeInterval(-4 * 3600), calendar: calendar
    ), "근무시간 밖")
    runner.expectNil(mascotNextTalkTrigger(
        state: MascotTalkState(copying: state, talkedToday: mascotTalkDailyMax), now: officeNow, calendar: calendar
    ), "하루 상한")
    runner.expectNil(mascotNextTalkTrigger(
        state: MascotTalkState(copying: state, userIdleSeconds: mascotAwaySeconds), now: officeNow, calendar: calendar
    ), "자리를 비운 동안 침묵")
    runner.expectEqual(mascotNextTalkTrigger(
        state: MascotTalkState(copying: state, lastSpokeAt: officeNow, userIdleSeconds: 0,
                               awaySince: officeNow.addingTimeInterval(-mascotAwaySeconds), finishedSinceLastTalk: 1),
        now: officeNow, calendar: calendar
    ), .returning, "복귀가 일보다 우선하며 최소 간격을 무시")
    runner.expectNil(mascotNextTalkTrigger(
        state: MascotTalkState(copying: state, lastSpokeAt: officeNow.addingTimeInterval(-179),
                               finishedSinceLastTalk: 1), now: officeNow, calendar: calendar
    ), "3분 미만")
    runner.expectEqual(mascotNextTalkTrigger(
        state: MascotTalkState(copying: state, finishedSinceLastTalk: 1, longestRunningSeconds: 600),
        now: officeNow, calendar: calendar
    ), .events, "끝난 일이 진행 상황보다 우선")
    runner.expectEqual(mascotNextTalkTrigger(
        state: MascotTalkState(copying: state,
                               finishedSinceLastTalk: mascotUnreportedFinishedCount(currentCount: 1, countAtRequest: 1),
                               longestRunningSeconds: 600), now: officeNow, calendar: calendar
    ), .progress, "빈 EVENTS 이후 진행 상황을 다시 고른다")
    runner.expectEqual(mascotNextTalkTrigger(
        state: MascotTalkState(copying: state, longestRunningSeconds: mascotProgressMinRunSeconds),
        now: officeNow, calendar: calendar
    ), .progress, "2분 진행")
    runner.expectNil(mascotNextTalkTrigger(
        state: MascotTalkState(copying: state, longestRunningSeconds: mascotProgressMinRunSeconds - 1,
                               mood: .working), now: officeNow, calendar: calendar
    ), "2분 미만 진행")
    runner.expectNil(mascotNextTalkTrigger(
        state: MascotTalkState(copying: state, longestRunningSeconds: 600,
                               lastProgressAt: officeNow.addingTimeInterval(-599), mood: .working),
        now: officeNow, calendar: calendar
    ), "진행 알림 10분 미만")
    runner.expectEqual(mascotNextTalkTrigger(
        state: MascotTalkState(copying: state, longestRunningSeconds: 600,
                               lastProgressAt: officeNow.addingTimeInterval(-600), mood: .working),
        now: officeNow, calendar: calendar
    ), .progress, "진행 알림 10분 경계")
    runner.expectNil(mascotNextTalkTrigger(
        state: MascotTalkState(copying: state, idleChanceRoll: mascotChatterChance),
        now: officeNow, calendar: calendar
    ), "idle 확률 경계")

    let accept = try! buildMascotSuggestionAcceptRequest(
        baseURL: URL(string: "http://127.0.0.1:3002")!, agentType: "CODE_REVIEWER",
        commandId: "command-1", persona: "USAGI", token: "secret"
    )
    runner.expectEqual(accept.url?.path, "/v1/console/mascot/suggestion/accept", "제안 수락 경로")
    runner.expectEqual(accept.httpMethod, "POST", "제안 수락 method")
    runner.expectEqual(accept.value(forHTTPHeaderField: "x-console-token"), "secret", "제안 수락 토큰")
    let acceptBody = try! JSONDecoder().decode([String: String].self, from: accept.httpBody!)
    runner.expectEqual(acceptBody["agentType"], "CODE_REVIEWER", "제안 타입")
    runner.expectEqual(acceptBody["commandId"], "command-1", "지시 id")
    runner.expectEqual(acceptBody["persona"], "USAGI", "페르소나")

    let shown = buildMascotChatterShownRequest(
        baseURL: URL(string: "http://127.0.0.1:3002")!, chatterId: "chatter-1", token: "secret"
    )
    runner.expectEqual(shown.url?.path, "/v1/console/mascot/chatter/chatter-1/shown", "표시 확인 경로")
    runner.expectEqual(shown.httpMethod, "POST", "표시 확인 method")
    runner.expectEqual(shown.value(forHTTPHeaderField: "x-console-token"), "secret", "표시 확인 토큰")
}
