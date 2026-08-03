import Foundation

@testable import ConsoleCore

/// SSE 라인 파서(순수)의 프레이밍 검증. 네트워크 자체는 대상 아님.
/// 백엔드 `@Sse('stream')` 는 `data: <json>\n\n` 형태로 이벤트를 흘려보낸다.
func runSSEParserTests(_ t: TestRunner) {
    t.suite("SSEParser")

    // 완전한 단일 이벤트 블록 → 1개 파싱, 버퍼 소진
    do {
        var buffer = "data: {\"type\":\"state.changed\",\"agentType\":\"PM\",\"state\":\"IN_PROGRESS\"}\n\n"
        let events = parseSSELine(&buffer)
        t.expectEqual(events.count, 1, "단일 이벤트 파싱")
        t.expectEqual(buffer, "", "완성 후 버퍼 소진")
        if case let .stateChanged(agentType, state) = events.first {
            t.expectEqual(agentType, "PM", "파싱된 agentType")
            t.expectEqual(state, .inProgress, "파싱된 state")
        } else {
            t.fail("stateChanged 로 파싱되어야 함")
        }
    }

    // 두 이벤트가 연속으로 들어오면 둘 다 파싱
    do {
        var buffer = ""
        buffer += "data: {\"type\":\"state.changed\",\"agentType\":\"PM\",\"state\":\"COMPLETED\"}\n\n"
        buffer += "data: {\"type\":\"state.changed\",\"agentType\":\"BE\",\"state\":\"IN_PROGRESS\"}\n\n"
        let events = parseSSELine(&buffer)
        t.expectEqual(events.count, 2, "연속 두 이벤트 파싱")
        t.expectEqual(buffer, "", "버퍼 소진")
    }

    // 미완성 청크(구분자 없음)는 0개 + 버퍼에 남는다
    do {
        var buffer = "data: {\"type\":\"state.chan"
        let events = parseSSELine(&buffer)
        t.expectEqual(events.count, 0, "미완성 청크는 파싱 안 됨")
        t.expect(!buffer.isEmpty, "미완성은 버퍼에 잔류")
    }

    // 부분 → 완성 순차 수신: 두 번째 호출에서 완성
    do {
        var buffer = "data: {\"type\":\"run.started\",\"run\":{\"id\":\"r1\","
        let first = parseSSELine(&buffer)
        t.expectEqual(first.count, 0, "1차: 아직 미완성")
        buffer += "\"agentType\":\"PM\",\"status\":\"IN_PROGRESS\",\"parentId\":null,\"startedAt\":\"2026-07-27T00:00:00Z\",\"finishedAt\":null}}\n\n"
        let second = parseSSELine(&buffer)
        t.expectEqual(second.count, 1, "2차: 완성 파싱")
        if case let .runStarted(run) = second.first {
            t.expectEqual(run.id, "r1", "이어붙인 run.id")
        } else {
            t.fail("runStarted 로 파싱되어야 함")
        }
    }

    // `data:` 뒤 공백 유무 모두 허용(SSE 규격상 공백 1개는 제거)
    do {
        var withSpace = "data: {\"type\":\"state.changed\",\"agentType\":\"PM\",\"state\":\"WAITING\"}\n\n"
        var noSpace = "data:{\"type\":\"state.changed\",\"agentType\":\"PM\",\"state\":\"WAITING\"}\n\n"
        t.expectEqual(parseSSELine(&withSpace).count, 1, "공백 있는 data:")
        t.expectEqual(parseSSELine(&noSpace).count, 1, "공백 없는 data:")
    }

    // 디코딩 불가한 이벤트는 건너뛰되 버퍼는 소비(스트림이 막히지 않음)
    do {
        var buffer = "data: {\"type\":\"totally.unknown\"}\n\ndata: {\"type\":\"state.changed\",\"agentType\":\"CTO\",\"state\":\"COMPLETED\"}\n\n"
        let events = parseSSELine(&buffer)
        t.expectEqual(events.count, 1, "미지 타입은 스킵, 유효 이벤트만")
        t.expectEqual(buffer, "", "미지 이벤트 블록도 버퍼에서 소비")
    }

    // SSE keep-alive 주석(`:` 시작)·기타 필드 라인은 무시
    do {
        var buffer = ": keep-alive\n\ndata: {\"type\":\"state.changed\",\"agentType\":\"PM\",\"state\":\"COMPLETED\"}\n\n"
        let events = parseSSELine(&buffer)
        t.expectEqual(events.count, 1, "주석 블록 무시, 데이터만 파싱")
    }

    // command 이벤트도 SSE 프레이밍을 거쳐 payload 를 보존
    do {
        var buffer = ""
        buffer += "data: {\"type\":\"command.rejected\",\"commandId\":\"c1\",\"reason\":\"PR 없음\"}\n\n"
        buffer += "data: {\"type\":\"command.info\",\"commandId\":\"c2\",\"message\":\"최근 PR 자동 선택\"}\n\n"
        let events = parseSSELine(&buffer)
        t.expectEqual(events.count, 2, "command 이벤트 2종 파싱")
        if case let .commandRejected(commandId, reason) = events.first {
            t.expectEqual(commandId, "c1", "rejected commandId")
            t.expectEqual(reason, "PR 없음", "rejected reason")
        } else {
            t.fail("첫 이벤트는 commandRejected 여야 함")
        }
        if case let .commandInfo(commandId, message) = events.last {
            t.expectEqual(commandId, "c2", "info commandId")
            t.expectEqual(message, "최근 PR 자동 선택", "info message")
        } else {
            t.fail("두 번째 이벤트는 commandInfo 여야 함")
        }
    }

    // 백엔드가 실제로 흘려보내는 프레이밍 그대로(`id:` 줄 + `data:` 줄 + 빈 줄).
    // NestJS @Sse 는 이벤트마다 `id:` 를 붙이므로 파서가 그 줄을 건너뛰고도 뽑아야 한다.
    do {
        var buffer = ""
        buffer += "id: 1\ndata: {\"type\":\"state.changed\",\"agentType\":\"PM\",\"state\":\"IN_PROGRESS\"}\n\n"
        buffer += "id: 2\ndata: {\"type\":\"state.changed\",\"agentType\":\"BE\",\"state\":\"COMPLETED\"}\n\n"
        let events = parseSSELine(&buffer)
        t.expectEqual(events.count, 2, "id 줄이 붙은 실제 프레이밍도 2건 파싱")
        t.expectEqual(buffer, "", "버퍼 소진")
    }

    // 구분자(빈 줄)가 사라진 입력은 한 건도 못 뽑는다 — 스트림을 `bytes.lines` 로 읽으면
    // 안 되는 이유다. AsyncLineSequence 는 연속 개행 사이의 빈 줄을 방출하지 않으므로,
    // 라인만 이어붙이면 정확히 아래 모양이 되고 이벤트가 영영 만들어지지 않는다.
    // 스트림은 바이트로 누적해 원본 개행을 보존해야 한다(SSEByteAccumulator).
    do {
        var buffer = ""
        buffer += "id: 1\ndata: {\"type\":\"state.changed\",\"agentType\":\"PM\",\"state\":\"IN_PROGRESS\"}\n"
        buffer += "id: 2\ndata: {\"type\":\"state.changed\",\"agentType\":\"BE\",\"state\":\"COMPLETED\"}\n"
        let events = parseSSELine(&buffer)
        t.expectEqual(events.count, 0, "빈 줄이 없으면 이벤트가 나오지 않는다")
        t.expect(!buffer.isEmpty, "구분자를 못 만나 전부 버퍼에 잔류")
    }

    runSSEByteAccumulatorTests(t)
}

/// 스트림 조립기(바이트 → 이벤트) 검증. 실제 앱이 SSE 를 읽는 경로와 같은 코드다.
/// 여기서 막지 못하면 "이벤트가 한 건도 안 온다" 가 조용히 재발한다.
private func runSSEByteAccumulatorTests(_ t: TestRunner) {
    t.suite("SSEByteAccumulator")

    let payload = "{\"type\":\"state.changed\",\"agentType\":\"PM\",\"state\":\"IN_PROGRESS\"}"
    let second = "{\"type\":\"state.changed\",\"agentType\":\"BE\",\"state\":\"COMPLETED\"}"

    /// 문자열을 바이트로 흘려넣고 누적된 이벤트를 모은다(실제 스트림과 같은 순서).
    func feed(_ chunks: [String], into accumulator: inout SSEByteAccumulator) -> [ConsoleEvent] {
        var events: [ConsoleEvent] = []
        for chunk in chunks {
            for byte in Array(chunk.utf8) {
                events.append(contentsOf: accumulator.consume(byte))
            }
        }
        return events
    }

    // LF 프레이밍 — 현재 백엔드(NestJS @Sse)가 실제로 보내는 형태.
    do {
        var accumulator = SSEByteAccumulator()
        let events = feed(["id: 1\ndata: \(payload)\n\nid: 2\ndata: \(second)\n\n"], into: &accumulator)
        t.expectEqual(events.count, 2, "LF 프레이밍 2건 수신")
    }

    // CRLF 프레이밍 — SSE 스펙이 허용하고 프록시가 끼면 나올 수 있다.
    do {
        var accumulator = SSEByteAccumulator()
        let events = feed(
            ["id: 1\r\ndata: \(payload)\r\n\r\nid: 2\r\ndata: \(second)\r\n\r\n"], into: &accumulator
        )
        t.expectEqual(events.count, 2, "CRLF 프레이밍도 2건 수신")
        if case let .stateChanged(agentType, state) = events.first {
            t.expectEqual(agentType, "PM", "CRLF payload 보존 — agentType")
            t.expectEqual(state, .inProgress, "CRLF payload 보존 — state")
        } else {
            t.fail("CRLF 첫 이벤트는 stateChanged 여야 함")
        }
    }

    // CR 단독 프레이밍 — 스펙상 유효한 세 번째 구분자.
    do {
        var accumulator = SSEByteAccumulator()
        let events = feed(["data: \(payload)\r\r"], into: &accumulator)
        t.expectEqual(events.count, 1, "CR 단독 프레이밍도 수신")
    }

    // 청크 경계가 이벤트 한가운데를 갈라도 손실 없이 재조립된다(TCP 는 경계를 보장하지 않는다).
    do {
        var accumulator = SSEByteAccumulator()
        let whole = "data: \(payload)\n\n"
        let cut = whole.index(whole.startIndex, offsetBy: 11)
        let events = feed([String(whole[..<cut]), String(whole[cut...])], into: &accumulator)
        t.expectEqual(events.count, 1, "청크가 쪼개져도 1건으로 재조립")
    }

    // 구분자 없이 라인만 이어지면 한 건도 안 나온다 — `bytes.lines` 회귀의 시그니처.
    do {
        var accumulator = SSEByteAccumulator()
        let events = feed(["id: 1\ndata: \(payload)\nid: 2\ndata: \(second)\n"], into: &accumulator)
        t.expectEqual(events.count, 0, "빈 줄 없는 스트림은 이벤트 0건")
    }
}
