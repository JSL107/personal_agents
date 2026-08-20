import Foundation

/// 조기 출근으로 인정하는 시작 시각. 이보다 이른 새벽은 "일이 돌고 있을 때만" 사람이 있다.
///
/// 5시로 잡은 근거는 원장 실측이다 — 14일간 새벽 5시에 INVEST 가 10건 돌았고 4시 이전은
/// 거의 비어 있다. 이 값을 4시로 내리면 아무도 없는 시간대에 빈 자리 판정만 늘어난다.
public let officeEarlyBirdStartHour = 5

/// 정규 출근 시각. 이 시각에 문이 열리고 나머지 인원이 들어온다.
public let officeArrivalHour = 9

/// 퇴근이 시작되는 시각. 이 시각 **부터** 일 없는 사람은 집으로 본다(20시는 아직 근무).
public let officeDepartureHour = 21

/// 지금 이 사람이 사무실에 있는가.
///
/// 걷는 중·들어오는 중 같은 과도 상태를 여기 두지 않는다. 그건 연출의 몫이고, 이 판정은
/// "있어야 하는가/없어야 하는가" 두 값만 답한다. 씬은 이 값이 바뀌는 순간을 보고 연출을 고른다.
public enum OfficeAttendance: String, Sendable, CaseIterable {
    case away
    case present
}

/// 출근 판정에 필요한 한 사람의 상태. 스냅샷에서 뽑아 넣는다.
public struct OfficeAttendanceInput: Equatable, Sendable {
    /// 진행 중인 실행이 있는가. 시각을 이기는 조건이다.
    public let hasActiveRun: Bool
    /// 오늘(KST 자정 이후) 성공으로 끝낸 건수. **밤 시간대 판정에는 쓰지 않는다** —
    /// 자정에 0 으로 리셋되므로 야근하다 자정을 넘긴 사람의 판정을 뒤집는다.
    public let doneToday: Int
    /// 대표실 앞 줄에 서 있는가. 다른 어떤 조건보다 앞선다.
    public let isQueued: Bool

    public init(hasActiveRun: Bool, doneToday: Int, isQueued: Bool) {
        self.hasActiveRun = hasActiveRun
        self.doneToday = doneToday
        self.isQueued = isQueued
    }
}

/// 이 사람이 지금 사무실에 있어야 하는가. 우선순위 순으로 판정하고 먼저 걸리면 멈춘다.
///
/// 음수와 24시 밖 입력도 같은 24시간 시계로 접는다(`officeDaylight(hour:)` 와 같은 방어).
public func officeAttendance(hour: Int, input: OfficeAttendanceInput) -> OfficeAttendance {
    // 1. 줄이 최우선. 줄 선 사람을 움직이면 대기열이 실제 상태와 어긋난다.
    if input.isQueued {
        return .present
    }
    // 2. 일하는 사람은 시각과 무관하게 자리에 있다.
    if input.hasActiveRun {
        return .present
    }
    let normalizedHour = ((hour % 24) + 24) % 24
    // 3. 정규 근무.
    if normalizedHour >= officeArrivalHour, normalizedHour < officeDepartureHour {
        return .present
    }
    // 4. 조기 출근자. 밤 시간대에는 이 규칙을 적용하지 않으므로 doneToday 의 자정 리셋이
    //    판정을 뒤집지 못한다.
    if normalizedHour >= officeEarlyBirdStartHour,
        normalizedHour < officeArrivalHour,
        input.doneToday > 0
    {
        return .present
    }
    return .away
}

/// 출근 적용을 부르는 경로가 지금 둘이다 — 시각 경계 타이머와 `sync`(에이전트 스냅샷이 바뀔 때마다).
/// 어느 쪽이 먼저 경계를 넘는지는 실행마다 다르므로, "이번 호출이 걷기 연출을 틀어야 하는가"라는
/// 판정을 두 경로가 각자 따로 내리게 두면 어긋난다. 시각 비교 자체는 순수 계산이라 여기 한 곳에
/// 모아 두 경로가 항상 같은 답을 내게 한다.
public enum OfficeAttendanceApplication: Sendable, Equatable {
    /// 이전에 본 시각이 없다 — 씬이 막 붙은 최초 호출. 걷는 사람 없이 최종 상태로 놓는다.
    case initial
    /// 시각이 실제로 넘어갔다 — 걷기 연출을 튼다.
    case boundaryCrossed
    /// 같은 시각 안의 재호출이다 — 이미 반영돼 있으므로 다시 놓을 이유가 없다.
    case sameHour
}

/// `previousHour`가 아직 없으면(nil) 최초 적용, 이전 시각과 다르면 경계를 넘은 것,
/// 같으면 같은 시각 안의 재호출이다. 자정 넘김(23 → 0)도 단순 비교라 boundaryCrossed 로 잡힌다.
public func officeAttendanceApplication(
    previousHour: Int?, currentHour: Int
) -> OfficeAttendanceApplication {
    guard let previousHour else {
        return .initial
    }
    if previousHour == currentHour {
        return .sameHour
    }
    return .boundaryCrossed
}
