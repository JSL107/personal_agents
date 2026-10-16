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

/// rawValue 는 사용자 그림 파일의 이름과 일치한다(`idle.png`, 여러 장이면 `thinking_1.png`…).
public enum MascotPose: String, CaseIterable, Sendable {
    case idle
    case blink
    case working
    case approval
    case failed
    /// 지시 답을 기다리는 동안(턱 괴고 고민).
    case thinking
    /// 답장 말풍선이 열려 있는 동안(쪽지를 읽음).
    case reading
    /// 답이 오거나 칭찬할 때 한 번(만세 점프).
    case happy
    /// 끌고 다니는 동안(대롱대롱).
    case dangle
    /// 마우스를 올렸을 때(커서를 올려다봄).
    case hover
    /// 클릭 직후 잠깐(간지러워함).
    case poke
    /// 일하는 부서별 소품 그림 — 기획(클립보드)·품질(돋보기)·평가(차트)·자산(주판)·콘텐츠(펜)·총무(드라이버).
    case planning
    case reviewing
    case evaluating
    case counting
    case writing
    case fixing
    /// 이대리 실행 없이 내 Claude Code·Codex 세션만 돌 때(노트북 타이핑).
    case typing

    /// 이 그림이 없을 때 대신 쓸 그림. 새 포즈는 그림이 생기기 전까지 기존 다섯 장으로 버틴다.
    public var fallback: MascotPose? {
        switch self {
        case .idle:
            return nil
        case .thinking, .planning, .reviewing, .evaluating, .counting, .writing, .fixing, .typing:
            return .working
        case .blink, .working, .approval, .failed, .reading, .happy, .dangle, .hover, .poke:
            return .idle
        }
    }
}

/// 지금 그릴 그림을 고르는 데 필요한 상태.
public struct MascotPoseContext: Equatable, Sendable {
    public var mood: MascotMood
    public var blinking = false
    public var thinking = false
    public var reading = false
    public var hovering = false
    public var dragging = false
    /// 한 번 재생하는 몸짓 그림(`happy`·`poke`). 짧게 켜졌다 꺼진다.
    public var flourish: MascotPose?
    /// 지금 하는 일의 소품 그림(`mascotActivity`). 없으면 nil.
    public var activity: MascotPose?

    public init(
        mood: MascotMood, blinking: Bool = false, thinking: Bool = false, reading: Bool = false,
        hovering: Bool = false, dragging: Bool = false, flourish: MascotPose? = nil, activity: MascotPose? = nil
    ) {
        self.activity = activity
        self.mood = mood
        self.blinking = blinking
        self.thinking = thinking
        self.reading = reading
        self.hovering = hovering
        self.dragging = dragging
        self.flourish = flourish
    }
}

/// 그림 우선순위: 끌기 > 한 번 몸짓 > 승인·실패 > 지시 대기 > 답장 읽기 > 마우스 올림 > 하는 일 소품 > 깜빡임 > 작업·쉼.
///
/// 끌기와 한 번 몸짓은 사용자가 방금 한 행동에 대한 즉답이라 무엇보다 먼저 보인다. 그다음은 사용자가
/// 처리할 일(승인·실패)이다 — 마우스를 올렸다고 승인 대기 자세가 가려지면 할 일을 놓친다.
public func mascotPose(_ context: MascotPoseContext) -> MascotPose {
    if context.dragging {
        return .dangle
    }
    if let flourish = context.flourish {
        return flourish
    }
    switch context.mood {
    case .awaitingApproval:
        return .approval
    case .failed:
        return .failed
    case .idle, .working:
        break
    }
    if context.thinking {
        return .thinking
    }
    if context.reading {
        return .reading
    }
    if context.hovering {
        return .hover
    }
    // 소품 그림에는 깜빡임을 섞지 않는다 — 깜빡임 그림에는 소품이 없어 몇 초마다 소품이 사라진다.
    if let activity = context.activity {
        return activity
    }
    if context.blinking {
        return .blink
    }
    return context.mood == .working ? .working : .idle
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
    mascotPose(MascotPoseContext(mood: mood, blinking: blinking))
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
