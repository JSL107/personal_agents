import Foundation

@testable import ConsoleCore

private func mascotTestCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
    return calendar
}

private func mascotTestDate(_ text: String) -> Date {
    officeParseIsoDate(text)!
}

private func mascotTestRun(
    startedAt: String, status: String = "IN_PROGRESS", finishedAt: String? = nil
) -> ConsoleRun {
    ConsoleRun(
        id: "run", agentType: "PM", status: status, parentId: nil,
        startedAt: startedAt, finishedAt: finishedAt
    )
}

private let mascotTestApproval = ConsoleApproval(
    id: "approval", agentType: "PM", title: "배포 승인", createdAt: "2026-10-15T00:00:00Z",
    expiresAt: "2026-10-16T00:00:00Z"
)

private let mascotTestBriefing = ConsoleBriefing(
    todos: [], streak: ConsoleStreak(current: 0, best: 3, todayOpened: 0, todayRemaining: 0),
    dailyReport: ConsoleDailyReport(
        date: "2026-10-15", succeeded: 0, failed: 0,
        approvalsOpened: 0, approvalsHandled: 0, pendingReviewPulls: 0
    ), serverTime: "2026-10-15T00:00:00Z"
)

func runMascotTests(_ runner: TestRunner) {
    runner.suite("Mascot voice")
    for moment in MascotMoment.allCases {
        runner.expect(!(mascotQuips[moment] ?? []).isEmpty, "\(moment) 후보가 있어야 한다")
        runner.expectEqual(mascotQuip(moment, random: 0), mascotQuips[moment]![0], "\(moment) 0 → 첫 후보")
        runner.expectEqual(
            mascotQuip(moment, random: 0.9999), mascotQuips[moment]!.last!, "\(moment) 1 직전 → 마지막 후보"
        )
    }
    runner.expectEqual(mascotSay(MascotQuip("야하!!"), "PM 결재 요청"), "야하!! (PM 결재 요청)", "정보는 괄호로")
    runner.expectEqual(mascotSay(MascotQuip("우라…", "심심해")), "우라… (심심해)", "고정 뜻도 괄호로")
    runner.expectEqual(mascotSay(MascotQuip("푸루루")), "푸루루", "뜻이 없으면 소리만")
    runner.expectEqual(mascotSay(MascotQuip("우라", "고정"), "  "), "우라 (고정)", "빈 정보는 고정 뜻으로 물러선다")

    runner.suite("Mascot pose priority")
    runner.expectEqual(
        mascotPose(MascotPoseContext(mood: .awaitingApproval, dragging: true)), .dangle, "끌기가 가장 먼저"
    )
    runner.expectEqual(
        mascotPose(MascotPoseContext(mood: .failed, flourish: .happy)), .happy, "한 번 몸짓이 승인·실패보다 먼저"
    )
    runner.expectEqual(
        mascotPose(MascotPoseContext(mood: .awaitingApproval, thinking: true, hovering: true)), .approval,
        "승인 대기는 지시 대기·마우스 올림보다 먼저"
    )
    runner.expectEqual(
        mascotPose(MascotPoseContext(mood: .idle, thinking: true, reading: true)), .thinking, "지시 대기가 읽기보다 먼저"
    )
    runner.expectEqual(
        mascotPose(MascotPoseContext(mood: .idle, reading: true, hovering: true)), .reading, "읽기가 마우스 올림보다 먼저"
    )
    runner.expectEqual(
        mascotPose(MascotPoseContext(mood: .working, blinking: true, hovering: true)), .hover, "마우스 올림이 깜빡임보다 먼저"
    )
    runner.expectEqual(MascotPose.thinking.fallback, .working, "고민 그림이 없으면 작업 자세")
    runner.expectEqual(MascotPose.dangle.fallback, .idle, "새 포즈는 쉼 그림으로 버틴다")
    runner.expect(MascotPose.idle.fallback == nil, "쉼 그림이 마지막")
    for pose in MascotPose.allCases {
        var chain: MascotPose? = pose
        var steps = 0
        while let current = chain, steps < 10 {
            chain = current.fallback
            steps += 1
        }
        runner.expect(chain == nil, "\(pose) 대체 사슬은 끝나야 한다")
    }

    runner.suite("Mascot reply split")
    let signed = mascotSplitReply("지연 없습니다.\n\n_이대리 (진행 현황 조회) · 실행 #9086_\n")
    runner.expectEqual(signed.body, "지연 없습니다.", "서명 앞까지가 본문")
    runner.expectEqual(signed.signature, "이대리 (진행 현황 조회) · 실행 #9086", "밑줄을 벗긴 서명")
    let plain = mascotSplitReply("그냥 답\n둘째 줄")
    runner.expectEqual(plain.body, "그냥 답\n둘째 줄", "서명이 없으면 그대로")
    runner.expect(plain.signature == nil, "서명이 없으면 nil")
    runner.expect(mascotSplitReply("_강조_로 시작하는 답").signature == nil, "한 줄 안의 강조는 서명이 아니다")
    runner.expectEqual(mascotFidgetDelay(random: 0), 15, "몸짓 간격 하한")
    runner.expectEqual(mascotFidgetDelay(random: 1), 35, "몸짓 간격 상한")

    runner.suite("Mascot chatter")
    let chatterNoon = mascotTestDate("2026-10-14T03:00:00.000Z")  // 수 12:00 KST
    let longAgo = chatterNoon.addingTimeInterval(-mascotChatterQuietSeconds)
    runner.expect(
        mascotChatterDue(mood: .idle, lastSpokeAt: longAgo, now: chatterNoon, calendar: mascotTestCalendar()),
        "쉬는 중·20분 조용·근무 시간이면 혼잣말"
    )
    runner.expect(
        !mascotChatterDue(
            mood: .idle, lastSpokeAt: chatterNoon.addingTimeInterval(-60), now: chatterNoon,
            calendar: mascotTestCalendar()
        ),
        "방금 말했으면 혼잣말 안 함"
    )
    runner.expect(
        !mascotChatterDue(mood: .working, lastSpokeAt: longAgo, now: chatterNoon, calendar: mascotTestCalendar()),
        "작업 중엔 혼잣말 안 함"
    )
    let lateNight = mascotTestDate("2026-10-14T14:00:00.000Z")  // 23:00 KST
    runner.expect(
        !mascotChatterDue(
            mood: .idle, lastSpokeAt: lateNight.addingTimeInterval(-3600), now: lateNight,
            calendar: mascotTestCalendar()
        ),
        "근무 시간 밖엔 혼잣말 안 함"
    )

    runner.suite("Mascot approval arming")
    let shownAt = Date(timeIntervalSince1970: 1_000_000)
    runner.expect(!mascotApprovalArmed(shownAt: shownAt, now: shownAt), "뜬 순간에는 승인 불가")
    runner.expect(
        !mascotApprovalArmed(shownAt: shownAt, now: shownAt.addingTimeInterval(0.79)),
        "0.8초 전에는 승인 불가"
    )
    runner.expect(
        // 정확히 0.8 을 더하면 큰 기준 시각에서 0.7999… 로 돌아와 경계 비교가 흔들린다.
        mascotApprovalArmed(shownAt: shownAt, now: shownAt.addingTimeInterval(0.81)),
        "0.8초가 지나면 승인 가능"
    )
    // `Date` 는 2001년 기준 초를 저장한다. 그 기준점(0)에서 재야 0.8 이 오차 없이 표현돼 `>=` 경계를
    // 정확히 잴 수 있다(1970년 0초도 내부값은 -978,307,200 이라 오차가 난다).
    let epoch = Date(timeIntervalSinceReferenceDate: 0)
    runner.expect(
        mascotApprovalArmed(shownAt: epoch, now: epoch.addingTimeInterval(mascotApprovalArmDelaySeconds)),
        "정확히 0.8초에 승인 가능"
    )

    runner.suite("Mascot")

    let now = mascotTestDate("2026-10-15T00:00:30Z")
    let visibleRun = mascotTestRun(startedAt: "2026-10-15T00:00:05Z")
    let hiddenRun = mascotTestRun(startedAt: "2026-10-15T00:00:25Z")
    let failedTodo = ConsoleTodo(kind: .failedRun, label: "실패", detail: "재시도")

    runner.expectEqual(mascotName, "우사기", "마스코트 이름은 한 곳에서 정한다")
    runner.expectEqual(
        mascotMood(approvals: [], runs: [], todos: [], now: now), .idle,
        "할 일이 없으면 쉰다"
    )
    runner.expectEqual(
        mascotMood(approvals: [], runs: [visibleRun], todos: [], now: now), .working,
        "20초가 지난 실행은 작업 중이다"
    )
    runner.expectEqual(
        mascotMood(approvals: [], runs: [visibleRun], todos: [failedTodo], now: now), .failed,
        "실패가 작업 중보다 우선한다"
    )
    runner.expectEqual(
        mascotMood(approvals: [mascotTestApproval], runs: [visibleRun], todos: [failedTodo], now: now),
        .awaitingApproval, "승인 대기가 가장 우선한다"
    )
    runner.expectEqual(
        mascotMood(approvals: [], runs: [hiddenRun], todos: [], now: now), .idle,
        "5초짜리 실행은 잠깐 숨긴다"
    )
    runner.expectEqual(
        mascotMood(approvals: [], runs: [mascotTestRun(startedAt: "broken")], todos: [], now: now),
        .working, "시각을 읽지 못하면 실행 자체를 숨기지 않는다"
    )
    for run in [
        mascotTestRun(startedAt: "2026-10-15T00:00:05Z", status: "SUCCEEDED"),
        mascotTestRun(startedAt: "2026-10-15T00:00:05Z", finishedAt: "2026-10-15T00:00:20Z")
    ] {
        runner.expectEqual(
            mascotMood(approvals: [], runs: [run], todos: [], now: now), .idle,
            "끝난 실행은 작업 중으로 세지 않는다"
        )
    }
    runner.expectEqual(
        mascotGraceRecheck(runs: [hiddenRun], now: now), mascotTestDate("2026-10-15T00:00:45Z"),
        "숨긴 실행이 20초가 되는 시각에 재확인한다"
    )
    runner.expectEqual(
        mascotGraceRecheck(runs: [visibleRun, hiddenRun], now: now), mascotTestDate("2026-10-15T00:00:45Z"),
        "보이는 실행이 있어도 숨긴 실행의 유예 종료 시각을 찾는다"
    )
    runner.expectEqual(mascotGraceRecheck(runs: [visibleRun], now: now), nil, "숨긴 실행이 없으면 예약하지 않는다")

    let calendar = mascotTestCalendar()
    runner.expectEqual(mascotBriefingSlot(now: mascotTestDate("2026-10-19T08:59:00+09:00"), calendar: calendar), nil, "월요일 9시 전")
    runner.expectEqual(mascotBriefingSlot(now: mascotTestDate("2026-10-19T09:00:00+09:00"), calendar: calendar), "2026-10-19-09", "월요일 9시")
    runner.expectEqual(mascotBriefingSlot(now: mascotTestDate("2026-10-23T18:59:00+09:00"), calendar: calendar), "2026-10-23-18", "금요일 19시 전")
    runner.expectEqual(mascotBriefingSlot(now: mascotTestDate("2026-10-23T19:00:00+09:00"), calendar: calendar), nil, "금요일 19시부터 쉰다")
    runner.expectEqual(mascotBriefingSlot(now: mascotTestDate("2026-10-24T10:00:00+09:00"), calendar: calendar), nil, "토요일은 쉬는 날이다")

    runner.expectEqual(
        mascotBriefingLines(briefing: mascotTestBriefing),
        ["지금 밀린 할 일은 없어요.", streakText(mascotTestBriefing.streak)],
        "빈 브리핑도 할 일과 연속 기록을 말한다"
    )
    let todoBriefing = ConsoleBriefing(
        todos: [failedTodo], streak: mascotTestBriefing.streak,
        dailyReport: mascotTestBriefing.dailyReport, serverTime: mascotTestBriefing.serverTime
    )
    runner.expectEqual(
        mascotBriefingLines(briefing: todoBriefing).first,
        officePresidentTodoLines(todos: [failedTodo]).first,
        "기존 할 일 문구 판정을 재사용한다"
    )

    var ledger = MascotReactionLedger()
    runner.expect(ledger.fireOnce("once", now: now), "처음 반응은 보인다")
    runner.expect(!ledger.fireOnce("once", now: now), "같은 반응은 재생하지 않는다")
    runner.expect(ledger.fireDaily(prefix: "cheer", max: 2, chance: 0.3, random: 0.1, now: now, calendar: calendar), "첫 응원")
    runner.expect(ledger.fireDaily(prefix: "cheer", max: 2, chance: 0.3, random: 0.1, now: now, calendar: calendar), "두 번째 응원")
    runner.expect(!ledger.fireDaily(prefix: "cheer", max: 2, chance: 0.3, random: 0.1, now: now, calendar: calendar), "하루 두 번 상한")
    runner.expect(!ledger.fireDaily(prefix: "cheer", max: 2, chance: 0.3, random: 0.5, now: now, calendar: calendar), "확률 밖이면 조용히 넘긴다")
    runner.expect(
        ledger.fireDaily(prefix: "cheer", max: 2, chance: 0.3, random: 0.1,
                         now: mascotTestDate("2026-10-16T00:00:30Z"), calendar: calendar),
        "다음 날에는 다시 응원할 수 있다"
    )
    runner.expectEqual(MascotReactionLedger.halfDayKey(now: mascotTestDate("2026-10-15T11:59:59+09:00"), calendar: calendar), "2026-10-15-am", "정오 직전")
    runner.expectEqual(MascotReactionLedger.halfDayKey(now: mascotTestDate("2026-10-15T12:00:00+09:00"), calendar: calendar), "2026-10-15-pm", "정오부터 오후")
    ledger.fired["old"] = now.addingTimeInterval(-15 * 86_400)
    ledger.prune(now: now)
    runner.expectEqual(ledger.fired["old"], nil, "15일 된 반응은 지운다")
    let restored = try? JSONDecoder().decode(MascotReactionLedger.self, from: JSONEncoder().encode(ledger))
    runner.expectEqual(restored, ledger, "재시작 뒤에도 반응 상한을 복원한다")

    let agent = ConsoleAgent(
        agentType: "PM", displayName: "기획 담당", slashCommands: [], description: "",
        state: .waiting, bubble: ""
    )
    runner.expectEqual(mascotApprovalHeadline(approval: mascotTestApproval, agents: [agent]), "기획 담당 결재 요청", "담당자 표시명을 보여 준다")
    let unassigned = ConsoleApproval(
        id: "unassigned", agentType: nil, title: "승인", createdAt: "", expiresAt: ""
    )
    runner.expectEqual(mascotApprovalHeadline(approval: unassigned, agents: [agent]), "이대리 결재 요청", "담당자가 없으면 이대리")
    runner.expectEqual(mascotPose(mood: .idle, blinking: true), .blink, "쉬는 때 눈을 깜박인다")
    runner.expectEqual(mascotPose(mood: .working, blinking: true), .blink, "작업 중에도 눈을 깜박인다")
    runner.expectEqual(mascotPose(mood: .working, blinking: false), .working, "깜박이지 않을 때는 작업 자세")
    runner.expectEqual(mascotPose(mood: .awaitingApproval, blinking: true), .approval, "승인 자세는 깜박이지 않는다")
    runner.expectEqual(mascotPose(mood: .failed, blinking: true), .failed, "실패 자세는 깜박이지 않는다")
}
