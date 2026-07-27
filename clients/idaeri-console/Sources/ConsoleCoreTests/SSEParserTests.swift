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
}
