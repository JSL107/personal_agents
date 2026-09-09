import ConsoleCore
import SwiftUI

/// A small, scalable coworker illustration shared by dashboard and office surfaces.
struct CozyAgentAvatarView: View {
    let appearance: CozyAgentAppearance
    let mood: CozyAgentMood
    let department: Department
    let state: ConsoleAgentState

    private let outlineWidth: CGFloat = 1.25

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                avatarShadow(in: proxy.size)
                roundedBody(in: proxy.size)
                ears(in: proxy.size)
                roundedHead(in: proxy.size)
                hair(in: proxy.size)
                face(in: proxy.size)
                accessory(in: proxy.size)
                stateProp(in: proxy.size)
            }
        }
        .aspectRatio(0.72, contentMode: .fit)
        .accessibilityHidden(true)
    }

    private var coatColor: Color { CozyPalette.palette(index: appearance.paletteIndex) }
    private var departmentAccent: Color { CozyPalette.department(department) }

    private func avatarShadow(in size: CGSize) -> some View {
        Ellipse()
            .fill(CozyPalette.avatarFaceInk.opacity(0.14))
            .frame(width: size.width * 0.52, height: size.height * 0.055)
            .position(x: size.width * 0.50, y: size.height * 0.975)
    }

    private func roundedBody(in size: CGSize) -> some View {
        ZStack {
            Capsule()
                .fill(coatColor)
                .frame(width: size.width * 0.48, height: size.height * 0.38)
                .overlay(Capsule().stroke(CozyPalette.outline, lineWidth: outlineWidth))
                .position(x: size.width * 0.50, y: size.height * 0.68)
            outfitDetails(in: size)
            Capsule()
                .fill(CozyPalette.avatarSkin)
                .frame(width: size.width * 0.12, height: size.height * 0.27)
                .overlay(Capsule().stroke(CozyPalette.outline, lineWidth: outlineWidth))
                .rotationEffect(.degrees(8))
                .position(x: size.width * 0.29, y: size.height * 0.75)
            Capsule()
                .fill(CozyPalette.avatarSkin)
                .frame(width: size.width * 0.12, height: size.height * 0.27)
                .overlay(Capsule().stroke(CozyPalette.outline, lineWidth: outlineWidth))
                .rotationEffect(.degrees(-8))
                .position(x: size.width * 0.71, y: size.height * 0.75)
        }
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
        let head = min(size.height * 0.42, size.width * 0.76)
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
                Circle()
                    .fill(CozyPalette.avatarSkin)
                    .overlay(Circle().stroke(CozyPalette.outline, lineWidth: outlineWidth))
            }
        }
        .frame(width: head, height: head)
        .position(x: size.width * 0.50, y: size.height * 0.35)
    }

    private func hair(in size: CGSize) -> some View {
        let hairColor = appearance.hairStyleIndex.isMultiple(of: 2) ? CozyPalette.avatarHair : CozyPalette.avatarFaceInk
        return Group {
            if appearance.hairStyleIndex % 3 == 0 {
                Path { path in
                    path.move(to: CGPoint(x: size.width * 0.27, y: size.height * 0.28))
                    path.addQuadCurve(to: CGPoint(x: size.width * 0.73, y: size.height * 0.28), control: CGPoint(x: size.width * 0.52, y: size.height * -0.16))
                    path.addLine(to: CGPoint(x: size.width * 0.69, y: size.height * 0.35))
                    path.addQuadCurve(to: CGPoint(x: size.width * 0.31, y: size.height * 0.35), control: CGPoint(x: size.width * 0.50, y: size.height * 0.25))
                    path.closeSubpath()
                }
                .fill(hairColor)
                .overlay(Path { path in
                    path.move(to: CGPoint(x: size.width * 0.27, y: size.height * 0.28))
                    path.addQuadCurve(to: CGPoint(x: size.width * 0.73, y: size.height * 0.28), control: CGPoint(x: size.width * 0.52, y: size.height * -0.16))
                }.stroke(CozyPalette.outline, lineWidth: outlineWidth))
            } else {
                Capsule()
                    .fill(hairColor)
                    .frame(width: size.width * 0.37, height: size.height * 0.12)
                    .position(x: size.width * 0.50, y: size.height * 0.10)
            }
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
                Circle().fill(CozyPalette.avatarFaceInk).frame(width: size.width * 0.035, height: size.width * 0.035).position(x: size.width * 0.43, y: eyeY)
                Circle().fill(CozyPalette.avatarFaceInk).frame(width: size.width * 0.035, height: size.width * 0.035).position(x: size.width * 0.57, y: eyeY)
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
