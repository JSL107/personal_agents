import ConsoleCore
import SwiftUI

/// A small, scalable coworker illustration shared by dashboard and office surfaces.
struct CozyAgentAvatarView: View {
    let appearance: CozyAgentAppearance
    let mood: CozyAgentMood
    let department: Department
    let state: ConsoleAgentState
    let pose: String

    init(
        appearance: CozyAgentAppearance,
        mood: CozyAgentMood,
        department: Department,
        state: ConsoleAgentState,
        pose: String = "idle"
    ) {
        self.appearance = appearance
        self.mood = mood
        self.department = department
        self.state = state
        self.pose = pose
    }

    private let outlineWidth: CGFloat = 1.25

    /// 대시보드 캐릭터는 정지 이미지 한 장이라 화면 전체가 죽어 보였다. 상태별로 주기만
    /// 다른 미세한 호흡(scale)을 얹어 생명감을 준다 — 레이아웃엔 손대지 않는 렌더 트랜스폼이라
    /// 카드 조판(겹침·높이)과는 무관하다.
    @State private var isInhaling = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if let image = SpriteLoader.cozyCharacterImage(
                    assetIndex: appearance.assetIndex,
                    pose: pose
                ) {
                    avatarShadow(in: proxy.size)
                    // Dashboard portraits are height-bound. The office correction also accounts
                    // for its width cap, so applying it here made equal cards visibly inconsistent.
                    let opticalScale = cozyDashboardCharacterVisualScale(
                        assetIndex: appearance.assetIndex,
                        pose: pose
                    )
                    let imageHeight = proxy.size.height * 0.90 * opticalScale
                    Image(nsImage: image)
                        .resizable()
                        .interpolation(.high)
                        .antialiased(true)
                        .scaledToFit()
                        // 알파 여백을 자른 실제 캐릭터 높이를 공통 기준으로 맞춘다. 가로·세로
                        // 양쪽 틀에 동시에 fit하면 머리가 넓은 캐릭터만 전체가 작아진다.
                        .frame(height: imageHeight)
                        // Scale around a shared shoe line instead of the image centre.
                        .position(
                            x: proxy.size.width / 2,
                            y: proxy.size.height * 0.99 - imageHeight / 2
                        )
                } else {
                    avatarShadow(in: proxy.size)
                    roundedBody(in: proxy.size)
                    ears(in: proxy.size)
                    roundedHead(in: proxy.size)
                    hair(in: proxy.size)
                    face(in: proxy.size)
                    accessory(in: proxy.size)
                    // The vector fallback needs a small state prop to communicate its action.
                    // Generated pose artwork already holds the relevant cup, document, laptop,
                    // or map in the character's hands; drawing this overlay again creates a
                    // style-mismatched object that appears to float beside the character.
                    stateProp(in: proxy.size)
                }
            }
        }
        // Square layout envelope guarantees that even the widest hair silhouette is height-bound.
        // A narrower envelope silently shrinks wide-haired assets before the shared shoe line applies.
        .aspectRatio(1.0, contentMode: .fit)
        // scaleEffect 는 렌더 트랜스폼이라 위 GeometryReader 가 재는 크기·자식 배치엔 영향이
        // 없다 — 숨 쉬듯 아주 살짝(2~3.5%) 커졌다 작아지는 것만 더한다.
        .scaleEffect(isInhaling ? 1 + breathingAmplitude : 1)
        .accessibilityHidden(true)
        .onAppear { startBreathingIfNeeded() }
        .onChange(of: state) { _ in startBreathingIfNeeded() }
    }

    /// 진행 중인 사람은 살짝 더 빠르게, 그 외엔 느긋하게 — 상태 자체가 바뀌는 신호를
    /// 몸짓에도 살짝 얹는다. 폭을 크게 벌리면 코지 톤을 깨므로 둘 다 미세하게만 다르다.
    private var breathingAmplitude: CGFloat {
        state == .inProgress ? 0.035 : 0.02
    }

    /// 오르내리는 한쪽 방향의 시간 — `repeatForever(autoreverses: true)` 가 왕복시키므로
    /// 실제 한 호흡 주기는 이 값의 두 배(진행 중 ≈2.2초, 그 외 ≈3.6초)로 "2~4초" 요건 안에 든다.
    private var breathingDuration: Double {
        state == .inProgress ? 1.1 : 1.8
    }

    /// 시스템 동작 줄이기가 켜져 있으면 시작하지 않는다(오피스 씬의 `shouldReduceMotion`과
    /// 같은 이유) — SwiftUI 환경값이라 사용자가 설정을 바꾸면 다음 렌더에서 바로 반영된다.
    private func startBreathingIfNeeded() {
        guard !reduceMotion else {
            isInhaling = false
            return
        }
        withAnimation(.easeInOut(duration: breathingDuration).repeatForever(autoreverses: true)) {
            isInhaling = true
        }
    }

    private var coatColor: Color { CozyPalette.palette(index: appearance.paletteIndex) }
    private var departmentAccent: Color { CozyPalette.department(department) }

    private func avatarShadow(in size: CGSize) -> some View {
        Ellipse()
            .fill(CozyPalette.avatarFaceInk.opacity(0.16))
            .frame(width: size.width * 0.46, height: size.height * 0.050)
            .blur(radius: size.width * 0.012)
            .position(x: size.width * 0.50, y: size.height * 0.975)
    }

    private func roundedBody(in size: CGSize) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: size.width * 0.12, style: .continuous)
                .fill(LinearGradient(colors: [coatColor.opacity(0.96), coatColor], startPoint: .top, endPoint: .bottom))
                .frame(width: size.width * 0.42, height: size.height * 0.29)
                .overlay(RoundedRectangle(cornerRadius: size.width * 0.12, style: .continuous).stroke(CozyPalette.outline.opacity(0.8), lineWidth: outlineWidth))
                .position(x: size.width * 0.50, y: size.height * 0.70)
            outfitDetails(in: size)
            Capsule()
                .fill(CozyPalette.avatarSkin)
                .frame(width: size.width * 0.105, height: size.height * 0.22)
                .overlay(Capsule().stroke(CozyPalette.outline, lineWidth: outlineWidth))
                .rotationEffect(.degrees(8))
                .position(x: size.width * 0.315, y: size.height * 0.75)
            Capsule()
                .fill(CozyPalette.avatarSkin)
                .frame(width: size.width * 0.105, height: size.height * 0.22)
                .overlay(Capsule().stroke(CozyPalette.outline, lineWidth: outlineWidth))
                .rotationEffect(.degrees(-8))
                .position(x: size.width * 0.685, y: size.height * 0.75)
            foot(in: size, x: 0.43)
            foot(in: size, x: 0.57)
        }
    }

    private func foot(in size: CGSize, x: CGFloat) -> some View {
        Capsule()
            .fill(CozyPalette.avatarFaceInk.opacity(0.72))
            .frame(width: size.width * 0.14, height: size.height * 0.035)
            .position(x: size.width * x, y: size.height * 0.86)
    }

    @ViewBuilder private func outfitDetails(in size: CGSize) -> some View {
        switch appearance.outfitStyleIndex {
        case 0:
            Capsule().fill(CozyPalette.avatarSkin.opacity(0.75)).frame(width: size.width * 0.16, height: size.height * 0.035).position(x: size.width * 0.50, y: size.height * 0.62)
        case 1:
            Circle().fill(departmentAccent).frame(width: size.width * 0.08).overlay(Circle().stroke(CozyPalette.outline, lineWidth: outlineWidth)).position(x: size.width * 0.50, y: size.height * 0.65)
        case 2:
            Capsule().fill(CozyPalette.avatarSkin.opacity(0.65)).frame(width: size.width * 0.22, height: size.height * 0.025).rotationEffect(.degrees(-12)).position(x: size.width * 0.50, y: size.height * 0.72)
        case 3:
            RoundedRectangle(cornerRadius: 2).fill(CozyPalette.butter).frame(width: size.width * 0.07, height: size.height * 0.10).overlay(RoundedRectangle(cornerRadius: 2).stroke(CozyPalette.outline, lineWidth: outlineWidth)).position(x: size.width * 0.50, y: size.height * 0.68)
        case 4:
            Capsule().fill(CozyPalette.apricot).frame(width: size.width * 0.28, height: size.height * 0.025).position(x: size.width * 0.50, y: size.height * 0.78)
        case 5:
            Circle().fill(CozyPalette.avatarSkin).frame(width: size.width * 0.10).overlay(Circle().stroke(CozyPalette.outline, lineWidth: outlineWidth)).position(x: size.width * 0.50, y: size.height * 0.60)
        default:
            EmptyView()
        }
    }

    private func ears(in size: CGSize) -> some View {
        HStack(spacing: size.width * 0.22) {
            Ellipse().fill(coatColor).overlay(Ellipse().stroke(CozyPalette.outline, lineWidth: outlineWidth))
            Ellipse().fill(coatColor).overlay(Ellipse().stroke(CozyPalette.outline, lineWidth: outlineWidth))
        }
        .frame(width: size.width * 0.58, height: size.height * 0.16)
        .position(x: size.width * 0.50, y: size.height * 0.29)
    }

    private func roundedHead(in size: CGSize) -> some View {
        let head = min(size.height * 0.43, size.width * 0.68)
        return Group {
            switch appearance.headShapeIndex {
            case 1:
                RoundedRectangle(cornerRadius: head * 0.38)
                    .fill(CozyPalette.avatarSkin)
                    .overlay(RoundedRectangle(cornerRadius: head * 0.38).stroke(CozyPalette.outline, lineWidth: outlineWidth))
            case 2:
                Ellipse()
                    .fill(CozyPalette.avatarSkin)
                    .overlay(Ellipse().stroke(CozyPalette.outline, lineWidth: outlineWidth))
            default:
                Ellipse()
                    .fill(LinearGradient(colors: [CozyPalette.avatarSkin, CozyPalette.avatarSkin.opacity(0.92)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .overlay(Ellipse().stroke(CozyPalette.outline, lineWidth: outlineWidth))
            }
        }
        .frame(width: head, height: head)
        .position(x: size.width * 0.50, y: size.height * 0.35)
    }

    private func hair(in size: CGSize) -> some View {
        let hairColor = appearance.hairStyleIndex.isMultiple(of: 2) ? CozyPalette.avatarHair : CozyPalette.avatarFaceInk
        return ZStack {
            Circle().fill(hairColor).frame(width: size.width * 0.43, height: size.height * 0.30).position(x: size.width * 0.40, y: size.height * 0.20)
            Circle().fill(hairColor).frame(width: size.width * 0.34, height: size.height * 0.26).position(x: size.width * 0.62, y: size.height * 0.20)
            if appearance.hairStyleIndex % 3 == 1 {
                Capsule().fill(hairColor).frame(width: size.width * 0.10, height: size.height * 0.22).position(x: size.width * 0.30, y: size.height * 0.32)
                Capsule().fill(hairColor).frame(width: size.width * 0.10, height: size.height * 0.22).position(x: size.width * 0.70, y: size.height * 0.32)
            } else if appearance.hairStyleIndex % 3 == 2 {
                Circle().fill(hairColor).frame(width: size.width * 0.13).position(x: size.width * 0.30, y: size.height * 0.16)
            }
            Path { path in
                path.move(to: CGPoint(x: size.width * 0.29, y: size.height * 0.27))
                path.addQuadCurve(to: CGPoint(x: size.width * 0.72, y: size.height * 0.27), control: CGPoint(x: size.width * 0.52, y: size.height * -0.02))
                path.addQuadCurve(to: CGPoint(x: size.width * 0.64, y: size.height * 0.36), control: CGPoint(x: size.width * 0.60, y: size.height * 0.28))
                path.addQuadCurve(to: CGPoint(x: size.width * 0.52, y: size.height * 0.29), control: CGPoint(x: size.width * 0.56, y: size.height * 0.40))
                path.addQuadCurve(to: CGPoint(x: size.width * 0.38, y: size.height * 0.36), control: CGPoint(x: size.width * 0.43, y: size.height * 0.40))
                path.closeSubpath()
            }.fill(hairColor)
            Circle().fill(Color.white.opacity(0.13)).frame(width: size.width * 0.06).position(x: size.width * 0.39, y: size.height * 0.12)
        }
    }

    private func face(in size: CGSize) -> some View {
        let eyeY = size.height * 0.36
        return ZStack {
            if mood == .happy {
                happyEye(at: CGPoint(x: size.width * 0.43, y: eyeY), in: size)
                happyEye(at: CGPoint(x: size.width * 0.57, y: eyeY), in: size)
            } else if mood == .waiting {
                waitingEye(at: CGPoint(x: size.width * 0.43, y: eyeY), in: size)
                waitingEye(at: CGPoint(x: size.width * 0.57, y: eyeY), in: size)
            } else {
                glossyEye(at: CGPoint(x: size.width * 0.43, y: eyeY), in: size)
                glossyEye(at: CGPoint(x: size.width * 0.57, y: eyeY), in: size)
            }
            if mood == .happy || mood == .calm || mood == .focused {
                blush(in: size)
            }
            if mood == .focused {
                Capsule().fill(CozyPalette.outline).frame(width: size.width * 0.12, height: outlineWidth).rotationEffect(.degrees(-12)).position(x: size.width * 0.43, y: eyeY - size.height * 0.035)
                Capsule().fill(CozyPalette.outline).frame(width: size.width * 0.12, height: outlineWidth).rotationEffect(.degrees(12)).position(x: size.width * 0.57, y: eyeY - size.height * 0.035)
            }
            if mood == .concerned {
                Capsule().fill(CozyPalette.outline).frame(width: size.width * 0.12, height: outlineWidth).rotationEffect(.degrees(18)).position(x: size.width * 0.43, y: eyeY - size.height * 0.035)
                Capsule().fill(CozyPalette.outline).frame(width: size.width * 0.12, height: outlineWidth).rotationEffect(.degrees(-18)).position(x: size.width * 0.57, y: eyeY - size.height * 0.035)
                Circle().stroke(CozyPalette.outline, lineWidth: outlineWidth).frame(width: size.width * 0.07, height: size.height * 0.045).position(x: size.width * 0.50, y: size.height * 0.415)
            } else if mood == .waiting {
                Capsule().fill(CozyPalette.outline).frame(width: size.width * 0.13, height: outlineWidth).position(x: size.width * 0.50, y: size.height * 0.415)
                Circle().fill(CozyPalette.outline).frame(width: size.width * 0.025).position(x: size.width * 0.50, y: size.height * 0.435)
            } else {
                Capsule().fill(CozyPalette.outline).frame(width: size.width * 0.10, height: outlineWidth).position(x: size.width * 0.50, y: size.height * 0.415)
            }
        }
    }

    private func glossyEye(at point: CGPoint, in size: CGSize) -> some View {
        ZStack {
            Ellipse().fill(CozyPalette.avatarFaceInk).frame(width: size.width * 0.075, height: size.height * 0.095)
            Circle().fill(Color.white.opacity(0.92)).frame(width: size.width * 0.027).offset(x: -size.width * 0.012, y: -size.height * 0.018)
            Circle().fill(Color.white.opacity(0.62)).frame(width: size.width * 0.014).offset(x: size.width * 0.014, y: size.height * 0.022)
        }.position(point)
    }

    private func blush(in size: CGSize) -> some View {
        HStack(spacing: size.width * 0.16) {
            Capsule().fill(CozyPalette.apricot.opacity(0.32)).frame(width: size.width * 0.09, height: size.height * 0.022)
            Capsule().fill(CozyPalette.apricot.opacity(0.32)).frame(width: size.width * 0.09, height: size.height * 0.022)
        }.position(x: size.width * 0.50, y: size.height * 0.415)
    }

    private func happyEye(at point: CGPoint, in size: CGSize) -> some View {
        Path { path in
            let width = size.width * 0.07
            let lift = size.height * 0.04
            path.move(to: CGPoint(x: point.x - width, y: point.y))
            path.addQuadCurve(to: CGPoint(x: point.x + width, y: point.y), control: CGPoint(x: point.x, y: point.y - lift))
        }.stroke(CozyPalette.avatarFaceInk, style: StrokeStyle(lineWidth: outlineWidth, lineCap: .round))
    }

    private func waitingEye(at point: CGPoint, in size: CGSize) -> some View {
        Capsule()
            .fill(CozyPalette.avatarFaceInk)
            .frame(width: size.width * 0.045, height: size.height * 0.018)
            .position(point)
    }

    private func accessory(in size: CGSize) -> some View {
        Group {
            if appearance.accessoryIndex == 0 {
                Circle().stroke(CozyPalette.outline, lineWidth: outlineWidth).frame(width: size.width * 0.16).position(x: size.width * 0.43, y: size.height * 0.36)
                Circle().stroke(CozyPalette.outline, lineWidth: outlineWidth).frame(width: size.width * 0.16).position(x: size.width * 0.57, y: size.height * 0.36)
            } else if appearance.accessoryIndex == 1 {
                Capsule().fill(CozyPalette.butter).frame(width: size.width * 0.10, height: size.height * 0.05).position(x: size.width * 0.50, y: size.height * 0.24)
            } else if appearance.accessoryIndex == 2 {
                Circle().fill(CozyPalette.apricot).frame(width: size.width * 0.09).overlay(Circle().stroke(CozyPalette.outline, lineWidth: outlineWidth)).position(x: size.width * 0.69, y: size.height * 0.48)
            } else if appearance.accessoryIndex == 3 {
                Capsule().fill(CozyPalette.sky).frame(width: size.width * 0.17, height: size.height * 0.035).overlay(Capsule().stroke(CozyPalette.outline, lineWidth: outlineWidth)).position(x: size.width * 0.50, y: size.height * 0.29)
            }
        }
    }

    @ViewBuilder private func stateProp(in size: CGSize) -> some View {
        switch state {
        case .waiting:
            mug(in: size)
        case .inProgress:
            laptop(in: size)
        case .awaitingApproval:
            document(in: size, x: 0.16, y: 0.61)
        case .awaitingIntegration:
            linkedNodes(in: size)
        case .completed:
            checkSparkle(in: size)
        case .failed:
            document(in: size, x: 0.79, y: 0.88)
            Capsule().fill(CozyPalette.apricot).frame(width: size.width * 0.025, height: size.height * 0.12).position(x: size.width * 0.82, y: size.height * 0.82)
            Circle().fill(CozyPalette.apricot).frame(width: size.width * 0.035).position(x: size.width * 0.82, y: size.height * 0.90)
        }
    }

    private func laptop(in size: CGSize) -> some View {
        RoundedRectangle(cornerRadius: 2).fill(CozyPalette.sky).frame(width: size.width * 0.25, height: size.height * 0.11).overlay(RoundedRectangle(cornerRadius: 2).stroke(CozyPalette.outline, lineWidth: outlineWidth)).position(x: size.width * 0.50, y: size.height * 0.68)
    }

    private func mug(in size: CGSize) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 3).fill(CozyPalette.butter).frame(width: size.width * 0.13, height: size.height * 0.10).overlay(RoundedRectangle(cornerRadius: 3).stroke(CozyPalette.outline, lineWidth: outlineWidth))
            Circle().stroke(CozyPalette.outline, lineWidth: outlineWidth).frame(width: size.width * 0.07, height: size.height * 0.06).offset(x: size.width * 0.075)
        }.position(x: size.width * 0.82, y: size.height * 0.68)
    }

    private func linkedNodes(in size: CGSize) -> some View {
        ZStack {
            Capsule().fill(CozyPalette.outline).frame(width: size.width * 0.13, height: outlineWidth).rotationEffect(.degrees(35)).position(x: size.width * 0.905, y: size.height * 0.52)
            Circle().fill(CozyPalette.lavender).frame(width: size.width * 0.10).overlay(Circle().stroke(CozyPalette.outline, lineWidth: outlineWidth)).position(x: size.width * 0.87, y: size.height * 0.48)
            Circle().fill(CozyPalette.sky).frame(width: size.width * 0.10).overlay(Circle().stroke(CozyPalette.outline, lineWidth: outlineWidth)).position(x: size.width * 0.94, y: size.height * 0.58)
        }
    }

    private func document(in size: CGSize, x: CGFloat, y: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 2).fill(CozyPalette.surface).frame(width: size.width * 0.13, height: size.height * 0.16).overlay(RoundedRectangle(cornerRadius: 2).stroke(CozyPalette.outline, lineWidth: outlineWidth)).rotationEffect(.degrees(-12)).position(x: size.width * x, y: size.height * y)
    }

    private func checkSparkle(in size: CGSize) -> some View {
        ZStack {
            Path { path in
                path.move(to: CGPoint(x: size.width * 0.72, y: size.height * 0.21))
                path.addLine(to: CGPoint(x: size.width * 0.76, y: size.height * 0.25))
                path.addLine(to: CGPoint(x: size.width * 0.84, y: size.height * 0.16))
            }.stroke(CozyPalette.sage, style: StrokeStyle(lineWidth: outlineWidth, lineCap: .round, lineJoin: .round))
            Capsule().fill(CozyPalette.butter).frame(width: size.width * 0.13, height: outlineWidth).rotationEffect(.degrees(45)).position(x: size.width * 0.88, y: size.height * 0.20)
            Capsule().fill(CozyPalette.butter).frame(width: size.width * 0.13, height: outlineWidth).rotationEffect(.degrees(-45)).position(x: size.width * 0.88, y: size.height * 0.20)
        }
    }
}
