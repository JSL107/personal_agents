import AppKit
import ConsoleCore
import SwiftUI

/// 사용자 그림은 공개 저장소에 두지 않고 앱 지원 폴더에서만 읽는다.
/// 포즈별 파일은 앱 실행 중 바꾸지 않는다는 계약이라 첫 접근 결과를 기억한다(없음도 기억한다).
private var mascotFrameCache: [MascotPose: [NSImage]] = [:]

/// 한 장(`<포즈>.png`)이 있으면 그것을, 없으면 `<포즈>_1.png`, `_2.png`… 를 이어지는 데까지 읽는다.
/// 여러 장이면 화면이 차례로 넘기며 움직이는 그림으로 보인다. 아무것도 없으면 빈 배열.
func mascotFrames(_ pose: MascotPose) -> [NSImage] {
    if let cached = mascotFrameCache[pose] {
        return cached
    }
    let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("IdaeriConsole/mascot", isDirectory: true)
    var frames: [NSImage] = []
    if let single = NSImage(contentsOf: folder.appendingPathComponent("\(pose.rawValue).png")) {
        frames = [single]
    } else {
        // 12장이면 초당 6장 기준 2초 — 반복 동작에 넉넉하다.
        for index in 1...12 {
            guard let frame = NSImage(contentsOf: folder.appendingPathComponent("\(pose.rawValue)_\(index).png")) else {
                break
            }
            frames.append(frame)
        }
    }
    mascotFrameCache[pose] = frames
    return frames
}

/// 그릴 그림을 대체 사슬(`MascotPose.fallback`)을 따라 찾는다. 깜빡임 그림이 없으면 쉼이 아니라
/// 깜빡이기 전 자세(`blinkBase`)로 물러선다 — 작업 중에 깜빡이는 순간 쉼 그림이 섞이지 않게.
func mascotResolvedFrames(_ pose: MascotPose, blinkBase: MascotPose) -> (pose: MascotPose, frames: [NSImage]) {
    var current: MascotPose? = pose
    while let candidate = current {
        let frames = mascotFrames(candidate)
        if !frames.isEmpty {
            return (candidate, frames)
        }
        current = candidate == .blink ? blinkBase : candidate.fallback
    }
    return (pose, [])
}

/// 포즈별 넘김 속도(초당 장 수). 고민·작업은 차분히, 만세는 빠르게.
func mascotFramesPerSecond(_ pose: MascotPose) -> Double {
    switch pose {
    case .poke:
        return 8
    case .happy:
        // 춤 4장 — 초당 6장이면 한 바퀴 0.67초, 2초 동안 세 바퀴.
        return 6
    case .working, .dangle, .planning, .reviewing, .evaluating, .counting, .writing, .fixing, .typing:
        return 6
    case .thinking, .reading, .hover:
        return 4
    case .idle, .blink, .approval, .failed:
        return 3
    }
}

/// 교체할 그림이 없을 때도 승인과 실패를 구별할 수 있도록 간단한 토끼와 배지를 그린다.
struct MascotPlaceholder: View {
    let mood: MascotMood
    let blinking: Bool

    private var badge: String? {
        switch mood {
        case .idle: return nil
        case .working: return "⋯"
        case .awaitingApproval: return "!"
        case .failed: return "×"
        }
    }

    var body: some View {
        ZStack {
            Ellipse().fill(Color(red: 0.97, green: 0.89, blue: 0.73))
                .frame(width: 20, height: 52).rotationEffect(.degrees(-12)).offset(x: -15, y: -26)
            Ellipse().fill(Color(red: 0.97, green: 0.89, blue: 0.73))
                .frame(width: 20, height: 52).rotationEffect(.degrees(12)).offset(x: 15, y: -26)
            Ellipse().fill(Color(red: 0.99, green: 0.94, blue: 0.83))
                .frame(width: 72, height: 66).offset(y: 12)
            HStack(spacing: 22) {
                Capsule().fill(Color.brown).frame(width: 5, height: blinking ? 2 : 7)
                Capsule().fill(Color.brown).frame(width: 5, height: blinking ? 2 : 7)
            }.offset(y: 7)
            HStack(spacing: 42) {
                Circle().fill(Color.pink.opacity(0.65)).frame(width: 9, height: 9)
                Circle().fill(Color.pink.opacity(0.65)).frame(width: 9, height: 9)
            }.offset(y: 18)
            if let badge {
                Text(badge)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 28, height: 28)
                    .background(mood == .failed ? Color.red : Color.orange, in: Circle())
                    .offset(x: 35, y: -30)
            }
        }
        .frame(width: MascotPanel.characterSide, height: MascotPanel.characterSide)
    }
}
