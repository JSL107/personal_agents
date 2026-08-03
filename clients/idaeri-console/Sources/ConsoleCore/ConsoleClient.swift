import Foundation

/// 백엔드 콘솔 API 클라이언트 에러.
public enum ConsoleClientError: Error {
    case badStatus(Int)
    case notHTTP
}

/// SSE 버퍼에서 완성된 이벤트를 잘라 디코딩하는 순수 파서.
///
/// 백엔드 `@Sse('stream')` 는 각 이벤트를 `data: <json>\n\n` 로 흘려보낸다. 스트림은 임의
/// 지점에서 쪼개져 도착하므로, 이벤트 구분자(빈 줄 = `\n\n`)가 나타난 완성 블록만 처리하고
/// 나머지는 `buffer` 에 그대로 남긴다. 다음 청크가 이어붙으면 다시 호출해 완성분을 뽑는다.
/// 디코딩 불가한 블록(미지의 타입 등)은 스킵하되 버퍼에서는 소비해 스트림이 막히지 않게 한다.
public func parseSSELine(_ buffer: inout String) -> [ConsoleEvent] {
    var events: [ConsoleEvent] = []
    while let separator = buffer.range(of: "\n\n") {
        let block = String(buffer[buffer.startIndex..<separator.lowerBound])
        buffer.removeSubrange(buffer.startIndex..<separator.upperBound)
        if let event = decodeSSEBlock(block) {
            events.append(event)
        }
    }
    return events
}

/// SSE 바이트 스트림 누적기 — 줄 구분자를 LF 로 정규화해 버퍼에 쌓고, 완성된 이벤트를 뽑는다.
///
/// 스트림을 `bytes.lines` 로 읽으면 안 된다. AsyncLineSequence 는 연속 개행 사이의 빈 줄을
/// 방출하지 않아 SSE 의 이벤트 구분자(`\n\n`)가 통째로 사라지고, 라인만 이어붙이면 버퍼에
/// 구분자가 영영 만들어지지 않아 파서가 한 건도 못 뽑는다(실측).
///
/// 그래서 바이트를 직접 받는데, 그 대가로 `lines` 가 해주던 줄바꿈 정규화도 잃는다.
/// SSE 는 CRLF·CR·LF 를 모두 줄 구분자로 허용하지만 파서는 LF 하나만 보므로 여기서 맞춘다.
/// 네트워크 없이 검증할 수 있도록 순수 상태로 둔다(SSEParserTests).
public struct SSEByteAccumulator {
    private static let lineFeed: UInt8 = 0x0A
    private static let carriageReturn: UInt8 = 0x0D

    private var buffer = ""
    private var line: [UInt8] = []
    private var previousByte: UInt8 = 0

    public init() {}

    /// 바이트 하나를 먹고, 그것으로 완성된 이벤트가 있으면 돌려준다(없으면 빈 배열).
    public mutating func consume(_ byte: UInt8) -> [ConsoleEvent] {
        // CRLF 의 뒤따르는 LF — 앞선 CR 이 이미 줄바꿈으로 처리됐으므로 버린다.
        if byte == Self.lineFeed, previousByte == Self.carriageReturn {
            previousByte = byte
            return []
        }
        previousByte = byte
        let normalized = byte == Self.carriageReturn ? Self.lineFeed : byte
        line.append(normalized)
        guard normalized == Self.lineFeed else {
            return []
        }
        buffer += String(decoding: line, as: UTF8.self)
        line.removeAll(keepingCapacity: true)
        return parseSSELine(&buffer)
    }
}

/// 한 이벤트 블록(빈 줄로 구분된 라인 묶음)에서 `data:` 라인들의 값을 이어붙여 디코딩한다.
private func decodeSSEBlock(_ block: String) -> ConsoleEvent? {
    var dataLines: [String] = []
    for rawLine in block.split(separator: "\n", omittingEmptySubsequences: false) {
        let line = rawLine.hasSuffix("\r") ? String(rawLine.dropLast()) : String(rawLine)
        guard line.hasPrefix("data:") else {
            // event:/id:/retry: 필드와 `:` 주석(keep-alive)은 v1 에서 무시.
            continue
        }
        var value = String(line.dropFirst("data:".count))
        if value.hasPrefix(" ") {
            value.removeFirst()
        }
        dataLines.append(value)
    }
    guard !dataLines.isEmpty else {
        return nil
    }
    let payload = dataLines.joined(separator: "\n")
    guard let data = payload.data(using: .utf8) else {
        return nil
    }
    return try? JSONDecoder().decode(ConsoleEvent.self, from: data)
}

/// `POST /v1/console/command` 요청을 구성하는 순수 함수(테스트를 위해 actor 밖).
public func buildCommandRequest(
    baseURL: URL,
    body: CommandRequest,
    token: String?
) throws -> URLRequest {
    let url = baseURL.appendingPathComponent("v1/console/command")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let token {
        request.setValue(token, forHTTPHeaderField: "x-console-token")
    }
    request.httpBody = try JSONEncoder().encode(body)
    return request
}

/// `POST /v1/console/sessions/:sessionId/inject` 요청을 구성하는 순수 함수.
public func buildInjectRequest(
    baseURL: URL,
    sessionId: String,
    text: String,
    token: String?
) throws -> URLRequest {
    let url = baseURL
        .appendingPathComponent("v1/console/sessions")
        .appendingPathComponent(sessionId)
        .appendingPathComponent("inject")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let token {
        request.setValue(token, forHTTPHeaderField: "x-console-token")
    }
    request.httpBody = try JSONEncoder().encode(InjectRequestBody(text: text))
    return request
}

/// 주입 결과. 백엔드는 실제 전달 시점(다음 Stop)을 관측할 수 없어 "큐잉됨"까지만 안다.
public enum InjectOutcome: Sendable, Equatable {
    case queued
    case failed(reason: String)
}

/// inject 응답 상태코드를 사용자용 결과로 매핑한다(순수).
public func injectOutcome(forStatus status: Int) -> InjectOutcome {
    switch status {
    case 200..<300:
        return .queued
    case 404:
        return .failed(reason: "세션을 찾을 수 없음")
    case 400:
        return .failed(reason: "빈 지시")
    default:
        return .failed(reason: "주입 실패 (\(status))")
    }
}

/// `POST /v1/console/approvals/:id/:action`(action = apply|cancel) 요청을 구성하는 순수 함수.
public func buildApprovalRequest(
    baseURL: URL,
    previewId: String,
    action: String,
    token: String?
) -> URLRequest {
    let url = baseURL
        .appendingPathComponent("v1/console/approvals")
        .appendingPathComponent(previewId)
        .appendingPathComponent(action)
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    if let token {
        request.setValue(token, forHTTPHeaderField: "x-console-token")
    }
    return request
}

/// 콘솔 백엔드에 대한 얇은 클라이언트. 부팅 시 스냅샷 1콜, 이후 SSE 구독 + 리모컨 write(지시/승인/거절).
/// 앱에는 LLM 로직이 없다 — write 는 백엔드에 그대로 위임하고 진행은 SSE 로 받는다.
public actor ConsoleClient {
    private let baseURL: URL
    private let token: String?
    private let session: URLSession

    public init(baseURL: URL, token: String? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }

    /// `GET /v1/console/snapshot`. REST 응답은 ResponseInterceptor 가 `{code,message,data}` 로
    /// 감싸므로 envelope 에서 `data` 를 꺼낸다.
    public func fetchSnapshot() async throws -> ConsoleSnapshot {
        let url = baseURL.appendingPathComponent("v1/console/snapshot")
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw ConsoleClientError.notHTTP
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ConsoleClientError.badStatus(http.statusCode)
        }
        let envelope = try JSONDecoder().decode(SnapshotEnvelope.self, from: data)
        return envelope.data
    }

    /// `GET /v1/console/stream` SSE 구독. 라인 스트림을 버퍼에 누적하며 완성 이벤트를 방출한다.
    /// SSE 는 `@RawResponse` 로 래핑을 건너뛰므로 payload 는 `ConsoleEvent` JSON 그대로다.
    /// 스트림이 끊기거나 취소되면 finish 되며, 재연결·재동기화는 호출자(B5 배선)가 관장한다.
    public func events() -> AsyncStream<ConsoleEvent> {
        let url = baseURL.appendingPathComponent("v1/console/stream")
        let session = self.session
        return AsyncStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: url)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    let (bytes, response) = try await session.bytes(for: request)
                    guard
                        let http = response as? HTTPURLResponse,
                        (200..<300).contains(http.statusCode)
                    else {
                        continuation.finish()
                        return
                    }
                    // 바이트를 그대로 넘긴다(이유는 SSEByteAccumulator 주석 참조).
                    var accumulator = SSEByteAccumulator()
                    for try await byte in bytes {
                        for event in accumulator.consume(byte) {
                            continuation.yield(event)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish()
                }
            }
            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    /// `POST /v1/console/command` — 지시. 백엔드는 202 로 접수만 하고 진행은 SSE 로 온다.
    public func postCommand(text: String, agentTypeHint: String?, commandId: String) async throws {
        let request = try buildCommandRequest(
            baseURL: baseURL,
            body: CommandRequest(text: text, agentTypeHint: agentTypeHint, commandId: commandId),
            token: token
        )
        try await sendExpectingSuccess(request)
    }

    /// `POST /v1/console/sessions/:id/inject` — 로컬 세션에 작업 주입. 동기 응답으로 결과 확정.
    public func postInject(sessionId: String, text: String) async throws -> InjectOutcome {
        let request = try buildInjectRequest(
            baseURL: baseURL,
            sessionId: sessionId,
            text: text,
            token: token
        )
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ConsoleClientError.notHTTP
        }
        return injectOutcome(forStatus: http.statusCode)
    }

    /// `POST /v1/console/approvals/:id/apply` — 승인.
    public func applyApproval(id: String) async throws {
        try await sendExpectingSuccess(
            buildApprovalRequest(baseURL: baseURL, previewId: id, action: "apply", token: token)
        )
    }

    /// `POST /v1/console/approvals/:id/cancel` — 거절.
    public func cancelApproval(id: String) async throws {
        try await sendExpectingSuccess(
            buildApprovalRequest(baseURL: baseURL, previewId: id, action: "cancel", token: token)
        )
    }

    private func sendExpectingSuccess(_ request: URLRequest) async throws {
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ConsoleClientError.notHTTP
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ConsoleClientError.badStatus(http.statusCode)
        }
    }
}

/// REST 응답 봉투. 실제 payload 는 `data` 에 담긴다.
private struct SnapshotEnvelope: Decodable {
    let data: ConsoleSnapshot
}
