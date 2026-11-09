import Foundation

/// 접미사 없는 기본 그림(`agent-{index}.png`). 스무 명 전원이 가지고 있어 최후의 대체가 된다.
public let cozyIdlePose = "idle"

/// 요청 이름을 에셋 어휘로 접는다.
///
/// **모르는 이름이 전부 `idle` 로 접히는 것이 이 함수의 요점이다.** 없는 이름을 그대로
/// 파일명으로 조립하면 로더가 매번 없는 파일을 찾아 헛돈다(정상 실행에서 폴백 로그가 수십 줄
/// 쏟아지던 원인).
///
/// 오피스 화면을 걷어낸 뒤(#875) 남은 화면은 대시보드 카드뿐이라 착석·걷기·가구 앞 자세
/// 원화도 함께 걷었다. 그 이름들은 이제 여기서 `idle` 로 접힌다.
public func normalizedCozyPose(_ requested: String) -> String {
    switch requested.lowercased().replacingOccurrences(of: "_", with: "-") {
    case "typing":
        return "typing"
    case "reading":
        return "reading"
    case "writing":
        return "writing"
    case "drinking":
        return "drinking"
    default:
        return cozyIdlePose
    }
}

/// 요청 포즈를 대신할 수 있는 에셋 포즈를 우선순위대로 준다(`idle` 은 제외 — 늘 마지막 보루).
public func cozyPoseCandidates(_ normalized: String) -> [String] {
    switch normalized {
    // `typing` 은 요청 이름일 뿐 원화가 없다. 예전 원화는 전부 앉은 그림이라 책상도 의자도
    // 없는 카드에서는 늘 걸러져 `writing` 으로 내려갔다 — 그 결과를 그대로 적어 둔다. 타이핑과
    // 쓰기는 손에 든 것이 다를 뿐 둘 다 "일하는 중" 이라 뜻이 가장 가깝다.
    case "typing":
        return ["writing"]
    case "reading":
        return ["reading"]
    case "writing":
        return ["writing", "reading"]
    case "drinking":
        return ["drinking"]
    default:
        return []
    }
}

/// 요청 포즈 → 실제 에셋. **모든 캐릭터 그림 선택이 지나는 단 하나의 지점.**
///
/// `hasAsset` 은 "이 포즈 파일이 실제로 있는가" 를 묻는 창구다. 파일 목록을 코어가 따로
/// 베껴 두지 않으므로(베끼면 에셋을 갈아끼울 때 조용히 어긋난다) 존재 판정은 번들을 보는
/// 렌더러가 넘기고, 여기서는 **순서**만 갖는다.
public func resolveCozyPose(
    requested: String,
    hasAsset: (String) -> Bool
) -> String {
    cozyPoseCandidates(normalizedCozyPose(requested)).first(where: hasAsset) ?? cozyIdlePose
}
