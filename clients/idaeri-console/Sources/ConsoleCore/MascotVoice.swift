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
    case poke
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
    .commandPrompt: [MascotQuip("우라?", "뭐 시킬 거야?"), MascotQuip("야하?", "뭐 해 줄까?")],
    .poke: [
        MascotQuip("우라?"), MascotQuip("야하!"), MascotQuip("푸루루"), MascotQuip("하아?"),
        MascotQuip("후음?"),
    ],
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
