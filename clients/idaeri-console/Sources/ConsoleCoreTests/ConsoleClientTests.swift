import Foundation

@testable import ConsoleCore

/// POST 요청 빌더가 method/헤더/경로/body 를 계약대로 만드는지 검증(네트워크 없이 순수 함수).
func runConsoleClientTests(_ t: TestRunner) {
    t.suite("ConsoleClient")

    let base = URL(string: "http://127.0.0.1:3002")!
    let listEnvelope = """
    {"code":"SUCCESS","message":"ok","data":[{"id":1,"title":"업무","dueDate":null,"status":"WHATEVER"}]}
    """.data(using: .utf8)!
    let decodedList = try! JSONDecoder().decode(SchedulesEnvelope.self, from: listEnvelope)
    t.expectEqual(decodedList.data.count, 1, "실제 목록 응답 data 봉투")
    t.expectEqual(decodedList.data[0].status, .open, "봉투 안 모르는 상태 복구")
    let detailEnvelope = """
    {"code":"SUCCESS","message":"ok","data":{"item":{"id":1,"title":"업무","dueDate":null,"status":"OPEN"},"followUps":[],"events":[],"linkedPullRequests":[],"pendingFollowUpCount":0}}
    """.data(using: .utf8)!
    let decodedDetail = try! JSONDecoder().decode(ScheduleDetailEnvelope.self, from: detailEnvelope)
    t.expectEqual(decodedDetail.data.item.id, 1, "실제 상세 응답 data 봉투")
    let createRequest = try! buildScheduleCreateRequest(
        baseURL: base, title: "배포", dueDate: "2026-11-07", memo: "",
        startDate: "2026-11-04", dueTime: "15:30", remindAt: "2026-11-07T05:30:00Z"
    )
    t.expectEqual(createRequest.httpMethod, "POST", "업무 등록 method")
    t.expectEqual(
        createRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/schedules",
        "업무 등록 경로"
    )
    let createBody = try! JSONSerialization.jsonObject(with: createRequest.httpBody!) as! [String: String]
    t.expectEqual(createBody["startDate"], "2026-11-04", "업무 시작일 본문")
    t.expectEqual(createBody["dueTime"], "15:30", "업무 마감 시각 본문")
    t.expectEqual(createBody["remindAt"], "2026-11-07T05:30:00Z", "업무 알림 시각 본문")
    t.expectNil(createBody["memo"], "빈 메모는 등록 본문에서 제외")

    let scheduleList = buildScheduleListRequest(baseURL: base, from: "2026-11-01", to: "2026-11-30")!
    t.expectEqual(scheduleList.httpMethod, "GET", "월 일정 조회 method")
    let undatedRequest = buildScheduleUndatedRequest(baseURL: base)
    t.expectEqual(undatedRequest.httpMethod, "GET", "기한 없음 조회 method")
    t.expectEqual(
        undatedRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/schedules/undated",
        "기한 없음 조회 경로"
    )
    let detailRequest = buildScheduleDetailRequest(baseURL: base, id: 12)
    t.expectEqual(detailRequest.httpMethod, "GET", "업무 상세 method")
    t.expectEqual(
        detailRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/schedules/12",
        "업무 상세 경로"
    )
    t.expectEqual(
        scheduleList.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/schedules?from=2026-11-01&to=2026-11-30&view=tracking",
        "월 일정 조회는 tracking 투영"
    )
    let schedulePatch = try! buildSchedulePatchRequest(
        baseURL: base, id: 12,
        fields: ["status": "IN_PROGRESS", "remindAt": nil]
    )!
    t.expectEqual(schedulePatch.httpMethod, "PATCH", "업무 편집 method")
    t.expectEqual(
        schedulePatch.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/schedules/12?view=tracking",
        "업무 편집 응답도 tracking 투영"
    )
    let patchBody = try! JSONSerialization.jsonObject(with: schedulePatch.httpBody!) as! [String: Any]
    t.expectEqual(patchBody["status"] as? String, "IN_PROGRESS", "업무 상태 본문")
    t.expectEqual(patchBody["remindAt"] is NSNull, true, "알림 해제는 JSON null")

    let followUpRequest = try! buildFollowUpRequest(
        baseURL: base, scheduleId: 12, recipient: "PM", topic: "배포 공유",
        trigger: .onDone, triggerAt: nil
    )
    t.expectEqual(followUpRequest.httpMethod, "POST", "연락할 일 method")
    t.expectEqual(
        followUpRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/schedules/12/follow-ups",
        "연락할 일 경로"
    )
    let followUpBody = try! JSONSerialization.jsonObject(with: followUpRequest.httpBody!) as! [String: String]
    t.expectEqual(followUpBody["trigger"], "ON_DONE", "연락할 일 trigger")
    t.expectEqual(followUpBody["topic"], "배포 공유", "연락할 일 topic")

    let noteRequest = try! buildScheduleNoteRequest(baseURL: base, scheduleId: 12, text: "확인 끝")
    t.expectEqual(noteRequest.httpMethod, "POST", "메모 method")
    t.expectEqual(
        noteRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/schedules/12/notes",
        "메모 경로"
    )
    let noteBody = try! JSONSerialization.jsonObject(with: noteRequest.httpBody!) as! [String: String]
    t.expectEqual(noteBody["text"], "확인 끝", "메모 본문")
    let sentRequest = try! buildFollowUpSentRequest(
        baseURL: base, id: 7, sentAt: "2026-11-04T12:00:00Z"
    )
    t.expectEqual(sentRequest.httpMethod, "PATCH", "보냄 표시 method")
    t.expectEqual(
        sentRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/follow-ups/7",
        "보냄 표시 경로"
    )
    let sentBody = try! JSONSerialization.jsonObject(with: sentRequest.httpBody!) as! [String: String]
    t.expectEqual(sentBody["sentAt"], "2026-11-04T12:00:00Z", "보냄 표시 본문")

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
    t.expectNil(decoded.persona, "기존 command 에 persona 없음")

    let mascotRequest = try! buildCommandRequest(
        baseURL: base,
        body: CommandRequest(text: "안녕", agentTypeHint: nil, commandId: "command-mascot", persona: "USAGI"),
        token: nil
    )
    let mascotBody = try! JSONDecoder().decode(
        CommandRequestEcho.self,
        from: mascotRequest.httpBody ?? Data()
    )
    t.expectEqual(mascotBody.persona, "USAGI", "마스코트 command persona")

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
    let persona: String?
}

private struct InjectBodyEcho: Decodable {
    let text: String
}
