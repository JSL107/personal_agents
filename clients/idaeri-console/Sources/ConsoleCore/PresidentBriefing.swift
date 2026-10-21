import Foundation

/// 할 일 한 줄의 종류. 백엔드 `ConsoleTodoKind` 와 1:1.
public enum ConsoleTodoKind: String, Codable, Sendable {
    case approval = "APPROVAL"
    case failedRun = "FAILED_RUN"
    case prReview = "PR_REVIEW"
}

/// 할 일 대상 하나. 실패 실행이면 `runId`·`agentType`, PR 리뷰면 `pullNumber`·`url` 이 있다.
public struct ConsoleTodoTarget: Codable, Equatable, Sendable {
    public let label: String
    public let agentType: String?
    public let runId: Int?
    /// 재시도 버튼을 띄워도 되는가(서버의 `REPLAYABLE_AGENT_TYPES`). 참이어도 실행별로 거절될 수 있다.
    public let retryable: Bool?
    /// 서버가 접수한 재시도가 지금 돌고 있다. 버튼 잠금의 정본.
    public let retrying: Bool?
    public let pullNumber: Int?
    public let url: String?

    public init(
        label: String, agentType: String? = nil, runId: Int? = nil, retryable: Bool? = nil,
        retrying: Bool? = nil, pullNumber: Int? = nil, url: String? = nil
    ) {
        self.label = label
        self.agentType = agentType
        self.runId = runId
        self.retryable = retryable
        self.retrying = retrying
        self.pullNumber = pullNumber
        self.url = url
    }

    /// 재시도 버튼을 그릴 run id. 지원하지 않는 종류면 nil.
    public var retryRunId: Int? {
        retryable == true ? runId : nil
    }
}

/// 대표 머리 위 말풍선과 대시보드 「대표 할 일」 목록이 쓰는 한 줄.
public struct ConsoleTodo: Codable, Equatable, Sendable {
    public let kind: ConsoleTodoKind
    public let label: String
    public let detail: String
    /// 이 할 일이 합쳐 놓은 대상들. 말풍선은 `label` 한 줄을 쓰고 목록이 대상마다 버튼을 그린다.
    public let targets: [ConsoleTodoTarget]

    public init(kind: ConsoleTodoKind, label: String, detail: String, targets: [ConsoleTodoTarget] = []) {
        self.kind = kind
        self.label = label
        self.detail = detail
        self.targets = targets
    }

    private enum CodingKeys: String, CodingKey {
        case kind, label, detail, targets
    }

    /// `targets` 가 없던 백엔드 응답도 받는다 — 앱과 서버가 따로 배포되는 동안 브리핑 전체가
    /// 디코딩 실패로 사라지지 않게.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(ConsoleTodoKind.self, forKey: .kind)
        label = try container.decode(String.self, forKey: .label)
        detail = try container.decode(String.self, forKey: .detail)
        targets = try container.decodeIfPresent([ConsoleTodoTarget].self, forKey: .targets) ?? []
    }
}

/// 인스펙터가 고른 담당자의 재시도 대상. 실패 할 일에 그 담당자가 있고 재시도를 지원할 때만.
public func retryTarget(agentType: String, todos: [ConsoleTodo]) -> ConsoleTodoTarget? {
    todos
        .filter { $0.kind == .failedRun }
        .flatMap(\.targets)
        .first { $0.agentType == agentType && $0.retryRunId != nil }
}

/// 연속 기록. 백엔드가 판정까지 끝낸 값이라 앱은 표시만 한다.
public struct ConsoleStreak: Codable, Equatable, Sendable {
    public let current: Int
    public let best: Int
    public let todayOpened: Int
    public let todayRemaining: Int

    public init(current: Int, best: Int, todayOpened: Int, todayRemaining: Int) {
        self.current = current
        self.best = best
        self.todayOpened = todayOpened
        self.todayRemaining = todayRemaining
    }

    /// 오늘 몫이 아직 남았는가. 남았으면 자정을 넘기는 순간 기록이 끊긴다.
    public var hasWorkLeftToday: Bool { todayRemaining > 0 }
}

/// 퇴근 정산 — 대표 옆에 놓이는 종이 한 장의 내용.
public struct ConsoleDailyReport: Codable, Equatable, Sendable {
    public let date: String
    public let succeeded: Int
    public let failed: Int
    public let approvalsOpened: Int
    public let approvalsHandled: Int
    public let pendingReviewPulls: Int

    public init(
        date: String, succeeded: Int, failed: Int,
        approvalsOpened: Int, approvalsHandled: Int, pendingReviewPulls: Int
    ) {
        self.date = date
        self.succeeded = succeeded
        self.failed = failed
        self.approvalsOpened = approvalsOpened
        self.approvalsHandled = approvalsHandled
        self.pendingReviewPulls = pendingReviewPulls
    }
}

/// `GET /v1/console/briefing` 응답.
public struct ConsoleBriefing: Codable, Equatable, Sendable {
    public let todos: [ConsoleTodo]
    public let streak: ConsoleStreak
    public let dailyReport: ConsoleDailyReport
    public let serverTime: String

    public init(
        todos: [ConsoleTodo], streak: ConsoleStreak,
        dailyReport: ConsoleDailyReport, serverTime: String
    ) {
        self.todos = todos
        self.streak = streak
        self.dailyReport = dailyReport
        self.serverTime = serverTime
    }
}

/// 대표 할 일 문장 후보를 긴 설명부터 짧은 건수까지 만든다.
public func officePresidentTodoLines(todos: [ConsoleTodo]) -> [String] {
    guard let first = todos.first else {
        return []
    }
    let remaining = todos.count - 1
    // 마지막 후보는 **라벨을 통째로 버리고 건수만** 남긴다.
    //
    // 라벨에는 워커 이름이 그대로 들어온다 — 실패 할 일은 백엔드가 `${agentType} 재시도` 로
    // 만들어서(`buildFailedRunTodo`) `IMPACT_REPORTER 재시도` 같은 15자 이름이 온다. 작은 창
    // (타일 27.4pt·20.6pt)에서는 라벨을 남긴 후보가 전부 몫을 넘겨, 말줄임표가 끝을 먹으면서
    // 하필 "몇 건 더 있다" 가 사라졌다. 라벨을 자르면 어느 워커인지 알 수 없게 되므로,
    // 개별 정보를 다 버리고 건수를 지키는 쪽을 최후 후보로 둔다.
    // **"건" 이 아니라 "가지" 다.** `todos` 한 항목은 한 건이 아니라 **한 종류** 다 — 백엔드가
    // 종류마다 집계해 라벨에 건수를 담는다(`승인 3건`, `PR 리뷰 회수 6건`). 실제 원장에서
    // 종류 1개에 6건이 들어 있는 것을 확인했으므로, 항목 수를 건수로 쓰면 6건이 "1건" 으로
    // 표시된다.
    let countOnly = "할 일 \(todos.count)가지"
    guard remaining > 0 else {
        // 한 건뿐이면 상세만 버려도 대개 들어간다. 그래도 안 들어가면 건수 후보로 내려간다.
        return ["\(first.label) — \(first.detail)", first.label, countOnly]
    }
    return [
        "\(first.label) — \(first.detail) · 외 \(remaining)건",
        "\(first.label) · 외 \(remaining)건",
        "\(first.label) 외 \(remaining)건",
        countOnly,
    ]
}

/// 연속 기록 한 줄. 끊긴 상태를 감추지 않는다.
public func streakText(_ streak: ConsoleStreak) -> String {
    if streak.current > 0 {
        return "🔥 깨끗하게 마감 \(streak.current)일 연속"
    }
    if streak.best > 0 {
        return "연속 0일 (최고 \(streak.best)일)"
    }
    return "연속 기록 없음"
}
