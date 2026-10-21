import Foundation

/// 서버가 검증한 제안 후보. 실행 여부는 사용자가 말풍선에서 결정한다.
public struct MascotChatterSuggestion: Decodable, Equatable, Sendable {
    public let agentType: String
    public let displayName: String
    public let reason: String
}

/// `POST /v1/console/mascot/chatter` 의 data payload. line 이 없으면 고정 문구로 대체한다.
public struct MascotChatterLine: Decodable, Equatable, Sendable {
    public let line: String?
    public let suggestion: MascotChatterSuggestion?
    public let asks: Bool
}

/// 답장 말풍선에 보여 줄, 앱 프로세스 안의 최근 대화 한 줄.
public struct MascotTurn: Equatable, Sendable {
    public enum Role: Equatable, Sendable {
        case user
        case usagi
    }

    public let role: Role
    public let text: String
    public let at: Date

    public init(role: Role, text: String, at: Date) {
        self.role = role
        self.text = text
        self.at = at
    }
}

public let mascotConversationTTLSeconds: TimeInterval = 30 * 60
public let mascotConversationMaxTurns = 10

/// 마지막 대화로부터 30분이 지나면 지난 내용을 보여 주지 않는다.
public func mascotLiveTurns(_ turns: [MascotTurn], now: Date) -> [MascotTurn] {
    guard let last = turns.last, now.timeIntervalSince(last.at) <= mascotConversationTTLSeconds else {
        return []
    }
    return turns
}

/// 최근 5왕복만 유지한다. 만료된 대화에는 새 turn 하나부터 다시 쌓는다.
public func mascotAppendTurn(_ turns: [MascotTurn], _ turn: MascotTurn, now: Date) -> [MascotTurn] {
    let live = mascotLiveTurns(turns, now: now)
    return Array((live + [turn]).suffix(mascotConversationMaxTurns))
}

/// REST 공통 봉투의 data 를 디코딩한다.
struct MascotChatterEnvelope: Decodable {
    let data: MascotChatterLine
}

struct MascotChatterRequestBody: Encodable {
    let declinedAgentTypes: [String]
}

/// 혼잣말 write 요청을 만든다. 서버의 loopback guard 와 token header 를 그대로 따른다.
public func buildMascotChatterRequest(
    baseURL: URL, declinedAgentTypes: [String], token: String?
) throws -> URLRequest {
    let url = baseURL.appendingPathComponent("v1/console/mascot/chatter")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let token {
        request.setValue(token, forHTTPHeaderField: "x-console-token")
    }
    request.httpBody = try JSONEncoder().encode(MascotChatterRequestBody(declinedAgentTypes: declinedAgentTypes))
    return request
}
