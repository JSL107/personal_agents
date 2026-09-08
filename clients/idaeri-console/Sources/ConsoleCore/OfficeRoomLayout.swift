import Foundation

/// 방 사각형(순수 값). (x, y) = 좌하단, y 는 위로 증가(SpriteKit 좌표계).
///
/// **이 파일에 남은 것은 이 값 타입과 전사 집계뿐이다.** 이름이 가리키던 `departmentRoomLayout`
/// (부서를 방 격자에 배치하던 초기 구현)은 타일 평면도(`officeFloorPlan`)로 대체된 뒤 테스트만
/// 부르고 있어서 지웠다. `OfficeRect` 는 창 크기 계산(`OfficeWindowSizing`)과 라벨 겹침 검사가
/// 계속 쓰므로 여기 남는다.
public struct OfficeRect: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

/// 상태별 전사 집계(순수).
public struct CompanySummary: Equatable, Sendable {
    public let inProgress: Int
    public let awaitingApproval: Int
    public let waiting: Int
    public let completed: Int
    public let awaitingIntegration: Int
    public init(
        inProgress: Int, awaitingApproval: Int, waiting: Int,
        completed: Int, awaitingIntegration: Int
    ) {
        self.inProgress = inProgress
        self.awaitingApproval = awaitingApproval
        self.waiting = waiting
        self.completed = completed
        self.awaitingIntegration = awaitingIntegration
    }
}

/// 좌상단 요약 판에 적을 줄들. 세션 구간이 있으면 **둘째 줄로 내린다.**
///
/// 한 줄로 이으면 세션 구간(`· 내 세션 19(도는 중 5)`)이 판 길이를 거의 두 배로 만든다.
/// 도면은 창이 작아지면 위로 올라오는데 이 판은 화면 좌상단에 고정이라, 최소 창에서 둘이
/// 같은 높이에서 만난다 — 720×560 에서 판 오른쪽 끝과 상단 밴드 대표 이름표 사이 여백이
/// 세션 9개에 20pt, 19개에 9pt 였다. 세션이 더 늘면 그대로 넘어간다.
///
/// 줄을 나누면 판 폭이 **첫 줄 길이로 묶인다** — 상태 세 칸은 사람 수가 두 자리여도
/// 길이가 거의 안 변하므로, 세션이 몇 개든 여백이 유지된다. 폭 상한을 두고 문구를 자르는
/// 대신 줄을 나눈 이유는, 세션 총계가 "대표 앞줄에 선 여덟" 을 전체로 오해하지 않게 하려고
/// 붙인 값이어서다 — 잘리면 그 목적이 사라진다.
public func officeCompanySummaryLines(
    summary: CompanySummary,
    sessionCount: Int,
    activeSessionCount: Int
) -> [String] {
    // "대기" 는 밀린 일감처럼 읽힌다 — 이대리에 대기 큐는 없고, 이 숫자는 **지금 맡은 일이
    // 없는 사람 수**(29명 중 27명이 예사)다. 적체로 오해하면 화면이 늘 비상처럼 보인다.
    let head =
        "진행 \(summary.inProgress)  ·  승인 \(summary.awaitingApproval)  ·  쉬는 중 \(summary.waiting)"
    guard sessionCount > 0 else {
        return [head]
    }
    return [head, "내 세션 \(sessionCount)(도는 중 \(activeSessionCount))"]
}

public func companySummary(agents: [ConsoleAgent]) -> CompanySummary {
    func count(_ state: ConsoleAgentState) -> Int {
        agents.filter { $0.state == state }.count
    }
    return CompanySummary(
        inProgress: count(.inProgress),
        awaitingApproval: count(.awaitingApproval),
        waiting: count(.waiting),
        completed: count(.completed),
        awaitingIntegration: count(.awaitingIntegration)
    )
}
