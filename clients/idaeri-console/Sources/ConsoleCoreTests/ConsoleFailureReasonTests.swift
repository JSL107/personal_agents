import Foundation

@testable import ConsoleCore

/// 상태코드 없는 실패(연결 불가·시간 초과)가 **서로 다른 문장**으로 갈라지는지 고정한다.
///
/// 둘이 한 문장으로 합쳐져 있던 동안, 정상으로 돌고 있는 승인이 60초를 넘겨 끊겼을 때
/// 화면이 "백엔드에 연결하지 못했습니다" 를 띄웠다. 백엔드는 멀쩡했고 사용자는 주소와
/// 프로세스를 확인하러 갔다 — 문장이 다음 행동을 잘못 가리킨 것이라, 갈라짐 자체가 계약이다.
func runConsoleFailureReasonTests(_ t: TestRunner) {
    t.suite("ConsoleFailureReason")

    let label = "http://127.0.0.1:3099"

    // 시간 초과 — 백엔드는 살아 있고 처리가 진행 중일 수 있다.
    let timedOut = consoleTransportFailureReason(URLError(.timedOut), baseURLLabel: label)
    t.expect(
        timedOut.contains("제때 응답하지 않았습니다"),
        "시간 초과는 응답 지연으로 안내 (받은 문장: \(timedOut))"
    )
    t.expect(
        !timedOut.contains("연결하지 못했습니다"),
        "시간 초과를 연결 실패로 부르지 않는다 (받은 문장: \(timedOut))"
    )

    // 연결 불가 — 백엔드가 떠 있는지부터 확인해야 한다. 주소를 문장에 싣는다.
    for code in [URLError.Code.cannotConnectToHost, .networkConnectionLost, .notConnectedToInternet] {
        let unreachable = consoleTransportFailureReason(URLError(code), baseURLLabel: label)
        t.expect(
            unreachable.contains("연결하지 못했습니다"),
            "\(code) 는 연결 실패로 안내 (받은 문장: \(unreachable))"
        )
        t.expect(
            unreachable.contains(label),
            "연결 실패 문장에 주소가 실린다 (받은 문장: \(unreachable))"
        )
    }

    // URLError 가 아닌 실패(디코딩 오류 등)도 연결 실패 쪽으로 떨어뜨린다 — 시간 초과라고
    // 단정할 근거가 없는 쪽이 안전하다. "기다리면 된다" 는 오안내가 더 비싸다.
    let decodingFailure = consoleTransportFailureReason(
        DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "broken")),
        baseURLLabel: label
    )
    t.expect(
        decodingFailure.contains("연결하지 못했습니다"),
        "알 수 없는 실패는 연결 실패로 안내 (받은 문장: \(decodingFailure))"
    )
}
