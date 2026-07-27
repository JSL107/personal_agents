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

/// 콘솔 백엔드에 대한 얇은 읽기 클라이언트. 부팅 시 스냅샷 1콜, 이후 SSE 구독.
/// 부작용 없는 read 전용이며, 앱에는 LLM 로직이 없다.
public actor ConsoleClient {
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
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
                    var buffer = ""
                    for try await line in bytes.lines {
                        // bytes.lines 는 개행을 제거하므로 구분자 복원을 위해 다시 붙인다.
                        buffer += line
                        buffer += "\n"
                        for event in parseSSELine(&buffer) {
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
}

/// REST 응답 봉투. 실제 payload 는 `data` 에 담긴다.
private struct SnapshotEnvelope: Decodable {
    let data: ConsoleSnapshot
}
