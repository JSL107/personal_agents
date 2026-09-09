import AppKit
import ConsoleCore
import SwiftUI

/// 사진 속 개인 사무실을 대시보드 카드 안에 압축한 작은 방.
///
/// 오피스 탭과 같은 픽셀 에셋을 재사용해 두 화면이 같은 회사처럼 보이게 한다. 상태색은
/// 책상 스탠드와 하단 선에만 쓰고, 방 자체는 따뜻한 목재·종이색으로 유지한다.
struct AgentRoomView: View {
    let agent: ConsoleAgent

    @Environment(\.colorScheme) private var colorScheme

    private var wallColor: Color {
        colorScheme == .dark
            ? Color(red: 0.18, green: 0.16, blue: 0.13)
            : Color(red: 0.95, green: 0.91, blue: 0.83)
    }

    private var floorColor: Color {
        colorScheme == .dark
            ? Color(red: 0.25, green: 0.20, blue: 0.15)
            : Color(red: 0.89, green: 0.80, blue: 0.65)
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                VStack(spacing: 0) {
                    wallColor.frame(height: proxy.size.height * 0.62)
                    floorColor
                }

                floorLines(size: proxy.size)

                HStack(spacing: Spacing.xs) {
                    Circle()
                        .fill(agent.state.accentColor)
                        .frame(width: 6, height: 6)
                    Text("LIVE OFFICE · \(agent.resolvedDepartment.label)")
                        .font(Typography.badgeMono)
                        .tracking(0.8)
                }
                .foregroundStyle(.secondary)
                .padding(Spacing.md)

                pixelSprite("furn-wall-landscape", width: 62)
                    .position(x: proxy.size.width * 0.22, y: proxy.size.height * 0.34)

                pixelSprite("furn-bookshelf", width: 44)
                    .position(x: proxy.size.width * 0.83, y: proxy.size.height * 0.52)

                pixelSprite("furn-plant-small", width: 28)
                    .position(x: proxy.size.width * 0.76, y: proxy.size.height * 0.64)

                pixelSprite("furn-desk", width: 112)
                    .position(x: proxy.size.width * 0.51, y: proxy.size.height * 0.62)

                pixelSprite("prop-laptop", width: 38)
                    .position(x: proxy.size.width * 0.51, y: proxy.size.height * 0.49)

                characterSprite
                    .position(x: proxy.size.width * 0.50, y: proxy.size.height * 0.68)

                Circle()
                    .fill(agent.state.accentColor.opacity(0.18))
                    .frame(width: 48, height: 48)
                    .blur(radius: 8)
                    .position(x: proxy.size.width * 0.62, y: proxy.size.height * 0.48)
                    .accessibilityHidden(true)

                Text(agent.bubble)
                    .font(Typography.caption)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .frame(maxWidth: min(proxy.size.width - 48, 250))
                    .background(
                        RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                            .fill(Color(nsColor: .windowBackgroundColor).opacity(0.94))
                            .shadow(color: .black.opacity(0.08), radius: 1, y: 1)
                    )
                    .position(x: proxy.size.width / 2, y: proxy.size.height - 30)
            }
            .clipped()
        }
        .frame(height: 190)
        .background(wallColor)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(agent.roleName)의 사무실, \(agent.bubble)")
    }

    private func floorLines(size: CGSize) -> some View {
        Path { path in
            let horizon = size.height * 0.62
            for index in 0...5 {
                let x = size.width * CGFloat(index) / 5
                path.move(to: CGPoint(x: size.width / 2, y: horizon))
                path.addLine(to: CGPoint(x: x, y: size.height))
            }
            for index in 1...3 {
                let progress = CGFloat(index) / 4
                let y = horizon + (size.height - horizon) * progress
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
            }
        }
        .stroke(Color.primary.opacity(0.07), lineWidth: 1)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func pixelSprite(_ name: String, width: CGFloat) -> some View {
        if let image = bundledSprite(name) {
            Image(nsImage: image)
                .resizable()
                .interpolation(.none)
                .scaledToFit()
                .frame(width: width)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private var characterSprite: some View {
        if let image = characterImage() {
            Image(nsImage: image)
                .resizable()
                .interpolation(.none)
                .scaledToFit()
                .frame(width: 48)
                .accessibilityHidden(true)
        }
    }

    private func bundledSprite(_ name: String) -> NSImage? {
        guard
            let url = Bundle.module.url(
                forResource: name,
                withExtension: "png",
                subdirectory: "sprites"
            )
        else {
            return nil
        }
        return NSImage(contentsOf: url)
    }

    private func characterImage() -> NSImage? {
        let look = characterLook(for: agent.agentType)
        let shirt = officeShirtColorRGB(
            department: agent.resolvedDepartment,
            shift: look.shirtShift
        )
        guard
            let texture = SpriteLoader.characterTexture(
                pose: "sit",
                sheet: look.sheetIndex,
                hair: hairPalette[look.hairIndex],
                shirt: shirt,
                pants: pantsPalette[look.pantsIndex]
            )
        else {
            return nil
        }
        let image = texture.cgImage()
        return NSImage(
            cgImage: image,
            size: NSSize(width: image.width, height: image.height)
        )
    }
}
