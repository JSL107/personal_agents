import AppKit
import ConsoleCore
import SwiftUI

/// 사용자 그림은 공개 저장소에 두지 않고 앱 지원 폴더에서만 읽는다.
/// 포즈별 파일은 앱 실행 중 바꾸지 않는다는 계약이라 첫 접근 결과를 기억한다.
private var mascotImageCache: [MascotPose: NSImage] = [:]
private var mascotMissingImages: Set<MascotPose> = []

func mascotImage(_ pose: MascotPose) -> NSImage? {
    if let image = mascotImageCache[pose] {
        return image
    }
    if mascotMissingImages.contains(pose) {
        return pose == .idle ? nil : mascotImage(.idle)
    }
    let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("IdaeriConsole/mascot", isDirectory: true)
    let path = folder.appendingPathComponent("\(pose.rawValue).png")
    if let image = NSImage(contentsOf: path) {
        mascotImageCache[pose] = image
        return image
    }
    mascotMissingImages.insert(pose)
    return pose == .idle ? nil : mascotImage(.idle)
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
        .frame(width: 96, height: 96)
    }
}
