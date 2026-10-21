import Foundation

/// 브리핑과 마스코트가 사용하는 하루의 시작과 종료 시각.
public let officeArrivalHour = 9
public let officeDepartureHour = 21

/// ISO8601 문자열을 파싱한다. 분수초 유무 둘 다 받는다.
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

/// 공유 렌더 옵션 `--size`의 양수 가로·세로 값을 읽는다.
public func officeParseRenderSize(_ raw: String) -> (width: Double, height: Double)? {
    let parts = raw.lowercased().split(separator: "x")
    guard parts.count == 2,
        let width = Double(parts[0]),
        let height = Double(parts[1]),
        width > 0,
        height > 0
    else {
        return nil
    }
    return (width, height)
}
