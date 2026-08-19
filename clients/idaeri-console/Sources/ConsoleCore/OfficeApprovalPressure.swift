import Foundation

/// 승인 카드가 얼마나 방치됐는지의 4단계. 화면 표현이 여기 대응한다.
public enum OfficeApprovalPressure: Int, Sendable, CaseIterable, Comparable {
    /// 줄에 선다(기존 동작).
    case queued = 1
    /// 손에 서류를 든다.
    case holdingPapers = 2
    /// 발을 구른다.
    case tapping = 3
    /// 대표 책상에 경고등이 켜진다.
    case alarm = 4

    public static func < (lhs: OfficeApprovalPressure, rhs: OfficeApprovalPressure) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// 단계가 올라가는 TTL 소진 비율.
///
/// **절대 경과 시간이 아니라 비율인 이유**: 카드 TTL 이 건마다 다르다(`ttlMs`, 권고 기본값
/// 1시간). "2시간 지나면 경고등" 으로 못 박으면 TTL 1시간 카드는 이미 만료된 뒤에 경고등이
/// 켜져, 가장 급한 카드에서 신호가 가장 늦게 나온다.
public let officeApprovalPressureThresholds = (
    holdingPapers: 0.25,
    tapping: 0.50,
    alarm: 0.80
)

/// 카드 하나의 방치 압력. 세 시각은 모두 기준점이 같은 초 단위 값이어야 한다.
///
/// 유효 구간(`expiresAt - createdAt`)이 0 이하면 비율을 계산할 수 없다. 그 경우 최고 단계로
/// 떨어뜨린다 — 계산 불가를 "급하지 않음" 으로 읽으면, 값이 깨진 카드가 조용히 만료된다.
public func officeApprovalPressure(
    now: TimeInterval,
    createdAt: TimeInterval,
    expiresAt: TimeInterval
) -> OfficeApprovalPressure {
    let lifespan = expiresAt - createdAt
    guard lifespan > 0 else {
        return .alarm
    }
    // 시계가 어긋나 now 가 생성보다 이를 수 있다. 음수 비율은 1단계로 접는다.
    let consumed = max(0, (now - createdAt) / lifespan)
    if consumed >= officeApprovalPressureThresholds.alarm {
        return .alarm
    }
    if consumed >= officeApprovalPressureThresholds.tapping {
        return .tapping
    }
    if consumed >= officeApprovalPressureThresholds.holdingPapers {
        return .holdingPapers
    }
    return .queued
}
