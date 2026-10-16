import Foundation

/// 마스코트가 말하는 순간. 순간마다 소리 후보를 여럿 두어 매번 같은 말을 하지 않게 한다.
public enum MascotMoment: String, CaseIterable, Sendable {
    case approval
    case trouble
    case briefingTodo
    case briefingClear
    case cheer
    case lots
    case dayDone
    case reply
    case commandPrompt
    case thinking
    case slow
    case chatter
}

/// 한 마디 — 우사기 소리와, 괄호로 덧붙이는 뜻.
///
/// 원작 우사기는 "우라", "야하", "하아?" 같은 소리만 낸다. 소리만으로는 무슨 일인지 알 수 없으므로
/// 뜻은 괄호에 따로 적는다. 소리가 캐릭터를, 괄호가 정보를 맡는다.
public struct MascotQuip: Equatable, Sendable {
    public let sound: String
    /// 고정된 뜻. 승인 제목처럼 그때그때 달라지는 정보는 `mascotSay` 에 따로 넘긴다.
    public let aside: String?

    public init(_ sound: String, _ aside: String? = nil) {
        self.sound = sound
        self.aside = aside
    }
}

/// 순간별 후보. 문구를 바꿀 때는 이 표만 고친다.
public let mascotQuips: [MascotMoment: [MascotQuip]] = [
    .approval: [MascotQuip("야하!!"), MascotQuip("야하~!"), MascotQuip("우라!")],
    .trouble: [MascotQuip("하아…?"), MascotQuip("하아?!"), MascotQuip("후엥…")],
    .briefingTodo: [MascotQuip("우라!"), MascotQuip("하아?"), MascotQuip("야하!")],
    .briefingClear: [
        MascotQuip("푸루루루~", "밀린 거 없어"), MascotQuip("야하~", "오늘 한가해"),
        MascotQuip("우라~", "깨끗해"),
    ],
    .cheer: [
        MascotQuip("야하!!", "하나 끝!"), MascotQuip("푸루루루루!", "끝냈다"),
        MascotQuip("우라라라!", "해치웠어"),
    ],
    .lots: [MascotQuip("하아…?", "할 거 많다…"), MascotQuip("우라…", "하나씩 하자")],
    .dayDone: [MascotQuip("야하~!!", "오늘 다 끝!"), MascotQuip("푸루루루~!", "퇴근각")],
    .reply: [MascotQuip("우라!"), MascotQuip("야하!")],
    .thinking: [MascotQuip("푸루루…", "생각 중"), MascotQuip("우라…", "알아보는 중"), MascotQuip("후음…", "잠깐만")],
    .slow: [MascotQuip("후엥…", "답이 안 와 — 콘솔에서 봐 줘")],
    .commandPrompt: [MascotQuip("우라?", "뭐 시킬 거야?"), MascotQuip("야하?", "뭐 해 줄까?")],
    .chatter: [
        MascotQuip("푸루루루루…"), MascotQuip("우라…", "심심해"), MascotQuip("야하~", "간식 시간 아냐?"),
        MascotQuip("후음…", "조용하다"), MascotQuip("하아~", "졸려"),
    ],
]

/// `random`(0..<1)으로 후보 하나를 고른다. 난수를 밖에서 받아 테스트가 고정할 수 있다.
public func mascotQuip(_ moment: MascotMoment, random: Double) -> MascotQuip {
    let candidates = mascotQuips[moment] ?? []
    guard !candidates.isEmpty else {
        return MascotQuip("…")
    }
    let index = min(candidates.count - 1, max(0, Int(random * Double(candidates.count))))
    return candidates[index]
}

/// 한 줄로 편다 — `소리 (뜻)`. 뜻은 넘긴 정보가 있으면 그것을, 없으면 후보의 고정 뜻을 쓴다.
public func mascotSay(_ quip: MascotQuip, _ info: String? = nil) -> String {
    let trimmed = info?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let aside = (trimmed?.isEmpty == false ? trimmed : nil) ?? quip.aside else {
        return quip.sound
    }
    return "\(quip.sound) (\(aside))"
}

/// 혼잣말을 꺼내도 되는 조용한 시간. 사람이 자리에 있을 법한 시간에만 말한다.
public let mascotChatterQuietSeconds: TimeInterval = 20 * 60

/// 지금 혼잣말을 해도 되는가 — 쉬는 중이고, 오래 조용했고, 근무 시간 안일 때.
public func mascotChatterDue(
    mood: MascotMood, lastSpokeAt: Date, now: Date, calendar: Calendar
) -> Bool {
    let hour = calendar.component(.hour, from: now)
    return mood == .idle
        && now.timeIntervalSince(lastSpokeAt) >= mascotChatterQuietSeconds
        && hour >= officeArrivalHour && hour < officeDepartureHour
}

/// 답장을 본문과 서명으로 나눈다.
///
/// 이대리 답의 마지막 줄은 `_이대리 (진행 현황 조회) · 실행 #9086_` 또는 연속 처리일 때
/// `_이대리 연속 처리 — A → B · 실행 #1, #2_` 서명이다(백엔드 `dispatch-reply.util.ts`). 본문과 같은
/// 크기로 섞어 두면 어디까지가 답인지 흐려지므로 떼어 작게 보인다.
///
/// **이 두 형식만 서명으로 본다.** 대화 응답·추가 입력 요청처럼 서명 없는 답도 오는데, 그 답이 기울임
/// 문단(`_주의 사항_`)으로 끝날 때 양 끝 밑줄만 보고 떼면 본문 마지막 문단이 작게 분리되거나, 한 줄짜리
/// 답은 본문이 통째로 비어 버린다.
public func mascotSplitReply(_ text: String) -> (body: String, signature: String?) {
    var lines = text.components(separatedBy: "\n")
    while let last = lines.last, last.trimmingCharacters(in: .whitespaces).isEmpty {
        lines.removeLast()
    }
    guard let last = lines.last?.trimmingCharacters(in: .whitespaces),
          last.range(of: #"^_이대리 .+ · 실행 #\d+(, #\d+)*_$"#, options: .regularExpression) != nil
    else {
        return (lines.joined(separator: "\n"), nil)
    }
    lines.removeLast()
    let body = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    return (body, String(last.dropFirst().dropLast()))
}

/// 평소 몸짓 사이 간격(초). 15~35초 사이에서 고른다 — 너무 잦으면 산만하고, 너무 드물면 멈춘 그림처럼 보인다.
public func mascotFidgetDelay(random: Double) -> TimeInterval {
    15 + 20 * min(1, max(0, random))
}

/// 지시를 보낸 뒤 답을 기다리는 최대 시간. 넘으면 "생각 중" 을 내리고 늦는다고 말한다.
public let mascotThinkingTimeoutSeconds: TimeInterval = 15 * 60
