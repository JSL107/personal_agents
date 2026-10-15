import Foundation

/// 별도 캐릭터의 이름을 한 곳에 둬 화면과 접근성 문구가 어긋나지 않게 한다.
public let mascotName = "우사기"
/// 시사의 20초 유예를 따라 짧은 cron 실행은 작업 자세로 바꾸지 않는다.
public let mascotWorkGraceSeconds: TimeInterval = 20
/// 사용자가 정한 평일 브리핑 종료 시각. 시작은 기존 출근 시각을 재사용한다.
public let mascotBriefingEndHour = 19

/// 승인 말풍선이 뜬 뒤 [승인] 버튼이 눌리기 시작하는 시간.
///
/// 말풍선은 커서 바로 밑에 새로 뜰 수 있고, 그 순간 패널이 마우스를 받기 시작한다. 사용자가 원래
/// 아래 앱(Dock·창 모서리)을 누르려던 클릭이 그대로 승인으로 들어가지 않도록, 사람이 말풍선을
/// 알아차릴 짧은 시간 동안은 누를 수 없게 둔다.
public let mascotApprovalArmDelaySeconds: TimeInterval = 0.8

/// 승인 말풍선이 `shownAt` 에 떴을 때 `now` 에 [승인]을 눌러도 되는가.
public func mascotApprovalArmed(shownAt: Date, now: Date) -> Bool {
    now.timeIntervalSince(shownAt) >= mascotApprovalArmDelaySeconds
}

public enum MascotMood: String, CaseIterable, Sendable {
    case idle
    case working
    case awaitingApproval
    case failed
}

/// rawValue 는 사용자 그림 파일의 이름과 일치한다.
public enum MascotPose: String, CaseIterable, Sendable {
    case idle
    case blink
    case working
    case approval
    case failed
}

/// 승인과 실패를 실행 상태보다 먼저 보여야 사용자가 처리할 일을 놓치지 않는다.
public func mascotMood(
    approvals: [ConsoleApproval], runs: [ConsoleRun], todos: [ConsoleTodo], now: Date
) -> MascotMood {
    if !approvals.isEmpty {
        return .awaitingApproval
    }
    if todos.contains(where: { $0.kind == .failedRun }) {
        return .failed
    }
    let hasVisibleRun = runs.contains { run in
        guard run.status == "IN_PROGRESS", run.finishedAt == nil else {
            return false
        }
        guard let startedAt = officeParseIsoDate(run.startedAt) else {
            return true
        }
        return now.timeIntervalSince(startedAt) >= mascotWorkGraceSeconds
    }
    return hasVisibleRun ? .working : .idle
}

/// 유예가 끝나는 첫 시각에 다시 확인해 60초 타이머를 기다리지 않는다.
public func mascotGraceRecheck(runs: [ConsoleRun], now: Date) -> Date? {
    runs.compactMap { run -> Date? in
        guard run.status == "IN_PROGRESS", run.finishedAt == nil,
              let startedAt = officeParseIsoDate(run.startedAt) else {
            return nil
        }
        let visibleAt = startedAt.addingTimeInterval(mascotWorkGraceSeconds)
        return visibleAt > now ? visibleAt : nil
    }.min()
}

public func mascotPose(mood: MascotMood, blinking: Bool) -> MascotPose {
    switch mood {
    case .idle:
        return blinking ? .blink : .idle
    case .working:
        return blinking ? .blink : .working
    case .awaitingApproval:
        return .approval
    case .failed:
        return .failed
    }
}

/// 달력의 시간대를 써서 같은 실시간도 사용자 현지의 정시 슬롯으로 기록한다.
public func mascotBriefingSlot(now: Date, calendar: Calendar) -> String? {
    let parts = calendar.dateComponents([.year, .month, .day, .weekday, .hour], from: now)
    guard let year = parts.year, let month = parts.month, let day = parts.day,
          let weekday = parts.weekday, let hour = parts.hour,
          (2...6).contains(weekday),
          hour >= officeArrivalHour, hour < mascotBriefingEndHour else {
        return nil
    }
    return String(format: "%04d-%02d-%02d-%02d", year, month, day, hour)
}

public func mascotBriefingLines(briefing: ConsoleBriefing) -> [String] {
    let todo = officePresidentTodoLines(todos: briefing.todos).first ?? "지금 밀린 할 일은 없어요."
    return [todo, streakText(briefing.streak)]
}

public func mascotApprovalHeadline(approval: ConsoleApproval, agents: [ConsoleAgent]) -> String {
    guard let agentType = approval.agentType else {
        return "이대리 결재 요청"
    }
    let displayName = agents.first(where: { $0.agentType == agentType })?.displayName ?? "이대리"
    return "\(displayName) 결재 요청"
}

/// 반응 기록을 디스크에 저장해 앱을 다시 열어도 일일 상한을 지킨다.
public struct MascotReactionLedger: Codable, Equatable {
    public var fired: [String: Date]

    public init(fired: [String: Date] = [:]) {
        self.fired = fired
    }

    public mutating func fireOnce(_ key: String, now: Date) -> Bool {
        guard fired[key] == nil else {
            return false
        }
        fired[key] = now
        return true
    }

    /// 확률과 일일 횟수 모두 통과해야 기록한다. 키의 번호로 그날의 사용량을 보존한다.
    public mutating func fireDaily(
        prefix: String, max: Int, chance: Double, random: Double, now: Date, calendar: Calendar
    ) -> Bool {
        guard random < chance, max > 0 else {
            return false
        }
        let dayPrefix = "\(prefix):\(Self.dayKey(now: now, calendar: calendar)):"
        let count = fired.keys.filter { $0.hasPrefix(dayPrefix) }.count
        guard count < max else {
            return false
        }
        fired["\(dayPrefix)\(count + 1)"] = now
        return true
    }

    public static func halfDayKey(now: Date, calendar: Calendar) -> String {
        let period = calendar.component(.hour, from: now) < 12 ? "am" : "pm"
        return "\(dayKey(now: now, calendar: calendar))-\(period)"
    }

    /// 오래된 기록은 일일 제한에 영향을 주지 않으므로 14일 뒤 제거한다.
    public mutating func prune(now: Date) {
        let cutoff = now.addingTimeInterval(-14 * 86_400)
        fired = fired.filter { $0.value >= cutoff }
    }

    private static func dayKey(now: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }
}
