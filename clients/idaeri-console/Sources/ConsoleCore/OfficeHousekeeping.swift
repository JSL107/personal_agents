import Foundation

/// 사무실 로봇청소기의 상태. 화면의 장식이 아니라 "청소가 살아 있는가" 를 드러내는 신호다.
public enum OfficeVacuumMode: Equatable, Sendable {
    /// 주기 안에 돌았다 — 바닥을 천천히 순회한다.
    case sweeping
    /// 아직 한 번도 안 돌았다 — 충전독에서 대기.
    case docked
    /// 주기를 넘겨 멈췄다. 청소가 죽은 것이라, 멈춘 청소기가 그 사실을 그대로 보여준다.
    case stalled
}

/// 청소 주기는 주 1회(일요일 09:00 KST)다. 한 회차를 놓쳐도 다음 주에 따라잡히므로
/// 8일까지는 정상으로 본다. 그보다 길면 스케줄이 끊긴 것이다.
public let officeVacuumHealthyIntervalDays: Int = 8

/// 쓰레기통에 쌓인 양. 청소기가 못 치우고 사람 판단으로 넘긴 프로젝트 수로 정한다.
/// 최대 3단계인 것은 40px 타일 안에서 눈으로 구분되는 높이가 그 정도이기 때문이다.
public let officeTrashMaxLevel: Int = 3

public func officeVacuumMode(ranAt: Date?, now: Date) -> OfficeVacuumMode {
    guard let ranAt else {
        return .docked
    }
    let elapsedDays = now.timeIntervalSince(ranAt) / 86_400
    // 미래 시각(시계 어긋남)은 방금 돈 것으로 본다 — 멈춘 것으로 오인해 거짓 경보를 내지 않는다.
    if elapsedDays < 0 {
        return .sweeping
    }
    return elapsedDays <= Double(officeVacuumHealthyIntervalDays) ? .sweeping : .stalled
}

public func officeTrashFillLevel(pendingProjects: Int) -> Int {
    if pendingProjects <= 0 {
        return 0
    }
    return min(pendingProjects, officeTrashMaxLevel)
}

/// ISO8601 문자열을 파싱한다. 분수초 유무 둘 다 받는다 — 서버가 `toISOString()` 으로
/// 밀리초를 붙여 보내는데, 기본 파서는 그 형식을 거부해 조용히 nil 이 된다.
public func officeParseIsoDate(_ raw: String?) -> Date? {
    guard let raw, raw.isEmpty == false else {
        return nil
    }
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let parsed = withFraction.date(from: raw) {
        return parsed
    }
    return ISO8601DateFormatter().date(from: raw)
}
