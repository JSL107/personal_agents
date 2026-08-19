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

/// 방치 압력을 다시 따지는 간격.
///
/// 이 판정은 `officeSessionSweepIntervalSeconds`(퇴근 판정)와 같은 종류의 문제를 안는다 —
/// **시간이 흐르기만 해도 결과가 바뀐다.** 하지만 화면 갱신은 SSE 이벤트(승인 개설/처리)에
/// 걸려 있고, 줄에 이미 서 있는 카드는 시간이 흘러도 그 자체로는 이벤트를 내지 않는다.
/// 시간축으로도 한 번씩 훑지 않으면, 카드가 몇 시간을 방치돼도 다음 무관한 이벤트가 올 때까지
/// 서류를 들지도 발을 구르지도 않는다 — 정확히 이 기능이 막으려는 상황이다.
public let officeApprovalPressureSweepIntervalSeconds: Double = 30

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

/// 방치 압력이 바뀐 사람 한 명의 갱신 지시.
public struct OfficeApprovalPressureChange: Equatable, Sendable {
    public let agentType: String
    public let pressure: OfficeApprovalPressure
    /// `createdAt`/`expiresAt` 파싱에 실패한 카드. `pressure` 는 이미 `.alarm` 이지만,
    /// 호출부가 원인을 로그로 남길 수 있게 따로 표시해 둔다.
    public let parseFailed: Bool

    public init(agentType: String, pressure: OfficeApprovalPressure, parseFailed: Bool) {
        self.agentType = agentType
        self.pressure = pressure
        self.parseFailed = parseFailed
    }
}

/// 승인 대기 줄의 방치 압력을 이전 적용값과 비교해 **바뀐 사람만** 골라낸다.
///
/// `OfficeScene` 은 SpriteKit 노드를 들고 있어 `ConsoleCoreTests` (XCTest 가 없는 실행형
/// 하네스, `ConsoleCore` 에만 링크)로는 검증할 수 없다. 그래서 "누구의 단계가 바뀌었는가" 라는
/// 순수 판정만 여기 떼어 두고, 씬은 이 결과를 SpriteKit 자세로 옮기기만 하는 얇은 어댑터로
/// 남긴다(`reconciledQueueOrder`/`OfficeScene.reconcileQueue` 와 같은 분리).
///
/// **바뀐 사람만 반환하는 이유**: 폴링마다 전부 다시 걸면 자세·소품이 매번 처음부터 다시 실행돼
/// 줄 전체가 깜빡인다(책상 소품이 결정론적으로 고정되는 것과 같은 이유).
///
/// **시각 파싱 실패는 `.alarm` 으로 읽는다**: `officeApprovalPressure` 자신의 비정상 lifespan
/// 방어(유효 구간 0 이하 → 경고등)와 같은 이유다. 파싱 실패를 "계산 불가 = 안 급함" 으로
/// 읽으면, 값이 깨진 카드가 조용히 "차분함" 으로 표시된 채 만료된다.
///
/// - Parameters:
///   - nodesPresent: 지금 화면에 캐릭터 노드가 있는 agentType 집합. 노드가 없으면 자세를
///     걸 대상이 없으므로 건너뛴다(다음 스윕에서 노드가 생기면 그때 처음으로 적용된다).
///   - previouslyApplied: 직전에 실제로 적용한 단계.
/// - Returns: `changes` — 이번에 새로 적용해야 할 단계 목록(대상마다 최대 1건).
///   `nextApplied` — 줄에서 빠진 사람(승인 목록에 더 이상 없음)의 기록을 지운 다음 상태.
///   남겨 두면 같은 사람이 나중에 다시 줄에 섰을 때 단계가 이미 올라간 것으로 읽혀
///   1단계 표현을 건너뛴다.
public func officeApprovalPressureUpdates(
    now: TimeInterval,
    approvals: [ConsoleApproval],
    nodesPresent: Set<String>,
    previouslyApplied: [String: OfficeApprovalPressure]
) -> (changes: [OfficeApprovalPressureChange], nextApplied: [String: OfficeApprovalPressure]) {
    var nextApplied = previouslyApplied
    var changes: [OfficeApprovalPressureChange] = []

    for approval in approvals {
        guard let agentType = approval.agentType, nodesPresent.contains(agentType) else {
            continue
        }

        let pressure: OfficeApprovalPressure
        let parseFailed: Bool
        if let createdAt = parseISODate(approval.createdAt),
            let expiresAt = parseISODate(approval.expiresAt)
        {
            pressure = officeApprovalPressure(
                now: now,
                createdAt: createdAt.timeIntervalSince1970,
                expiresAt: expiresAt.timeIntervalSince1970
            )
            parseFailed = false
        } else {
            pressure = .alarm
            parseFailed = true
        }

        guard nextApplied[agentType] != pressure else {
            continue
        }
        nextApplied[agentType] = pressure
        changes.append(
            OfficeApprovalPressureChange(agentType: agentType, pressure: pressure, parseFailed: parseFailed)
        )
    }

    let queued = Set(approvals.compactMap(\.agentType))
    nextApplied = nextApplied.filter { queued.contains($0.key) }
    return (changes, nextApplied)
}
