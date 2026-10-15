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
