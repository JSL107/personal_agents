import AppKit
import ConsoleCore
import SwiftUI

enum MascotBubble: Equatable {
    case notice(String)
    case commandInput
    case approval(id: String, headline: String, title: String, more: Int, submitted: Bool, armed: Bool)
    case reply(String)
    case briefing([String])
    case reaction(String)
}

private struct MascotHitRects: PreferenceKey {
    static var defaultValue: [CGRect] = []

    static func reduce(value: inout [CGRect], nextValue: () -> [CGRect]) {
        value.append(contentsOf: nextValue())
    }
}

private struct MascotHitArea: ViewModifier {
    func body(content: Content) -> some View {
        content.background {
            GeometryReader { geometry in
                Color.clear.preference(
                    key: MascotHitRects.self,
                    value: [geometry.frame(in: .named("mascotPanel"))]
                )
            }
        }
    }
}

/// 패널 좌표로 알린 두 영역만 마우스를 받는다. 레이아웃이 바뀌는 말풍선도 실제 크기를 쓴다.
struct MascotView: View {
    @ObservedObject var controller: MascotController
    /// 끌기 시작 순간의 패널 원점과 화면 기준 포인터 위치.
    @State private var dragStart: (panel: NSPoint, mouse: NSPoint)?
    @State private var commandText = ""
    @FocusState private var commandFieldFocused: Bool
    /// 숨쉬기 — 평소에 아주 천천히 위아래로 부푼다.
    @State private var breathing = false
    /// 마우스를 올리면 고개를 갸웃한다.
    @State private var hovering = false
    /// 이벤트 몸짓이 지금 더하는 값. 재생이 끝나면 0·1 로 돌아온다.
    @State private var hopOffset: CGFloat = 0
    @State private var shakeAngle: Double = 0
    @State private var squish: CGFloat = 0

    var body: some View {
        GeometryReader { geometry in
            // 말풍선과 캐릭터를 같은 세로축(패널 가운데)에 세운다. 오른쪽 끝으로 맞추면 그림이 96pt 칸 안에
            // 좌우 여백을 두고 그려져 있어 말풍선 끝과 몸이 어긋나 보인다.
            VStack(alignment: .center, spacing: 10) {
                Spacer(minLength: 0)
                if let bubble = controller.bubble {
                    bubbleView(bubble)
                        .frame(maxWidth: 300, alignment: .center)
                        .modifier(MascotHitArea())
                }
                character
                    .modifier(MascotHitArea())
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .padding(12)
            .onPreferenceChange(MascotHitRects.self) { rects in
                // SwiftUI 는 위에서 아래로, AppKit 패널은 아래에서 위로 좌표가 증가한다.
                let panelRects = rects.map { rect in
                    CGRect(
                        x: rect.minX,
                        y: geometry.size.height - rect.maxY,
                        width: rect.width,
                        height: rect.height
                    )
                }
                controller.panel.updateInteractiveRects(panelRects)
            }
        }
        .coordinateSpace(name: "mascotPanel")
        .frame(width: 340, height: 300)
    }

    private var character: some View {
        characterImage
            // 숨쉬기는 아래(발)를 기준으로 부풀어야 땅에 선 채 숨쉬는 것처럼 보인다.
            .scaleEffect(
                x: (breathing ? 1.012 : 1) + squish,
                y: (breathing ? 0.985 : 1) - squish,
                anchor: .bottom
            )
            .rotationEffect(.degrees((hovering ? -5 : 0) + shakeAngle), anchor: .bottom)
            .offset(y: hopOffset)
            .onAppear {
                withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) {
                    breathing = true
                }
            }
            .onHover { inside in
                withAnimation(.spring(response: 0.25, dampingFraction: 0.55)) {
                    hovering = inside
                }
            }
            .onChange(of: controller.motion) { motion in
                play(motion.kind)
            }
            .contentShape(Rectangle())
            .accessibilityLabel("\(mascotName), \(moodLabel)")
            .onTapGesture(count: 2) { controller.openCommandInput() }
            .onTapGesture(count: 1) { controller.poke() }
            .gesture(dragGesture)
    }

    /// 몸짓 재생. macOS 13 에는 키프레임 애니메이션이 없어 짧은 단계를 시간차로 잇는다.
    private func play(_ kind: MascotMotion.Kind) {
        switch kind {
        case .hop:
            withAnimation(.spring(response: 0.18, dampingFraction: 0.6)) { hopOffset = -18 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) {
                withAnimation(.spring(response: 0.32, dampingFraction: 0.45)) { hopOffset = 0 }
            }
        case .shake:
            let angles: [Double] = [-9, 8, -6, 5, -3, 0]
            for (index, angle) in angles.enumerated() {
                DispatchQueue.main.asyncAfter(deadline: .now() + Double(index) * 0.07) {
                    withAnimation(.easeInOut(duration: 0.07)) { shakeAngle = angle }
                }
            }
        case .squish:
            withAnimation(.easeOut(duration: 0.08)) { squish = 0.12 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.4)) { squish = 0 }
            }
        }
    }

    private var characterImage: some View {
        Group {
            if let image = mascotImage(mascotPose(mood: controller.mood, blinking: controller.blinking))
                ?? mascotImage(mascotPose(mood: controller.mood, blinking: false))
            {
                Image(nsImage: image).resizable().interpolation(.high).scaledToFit()
                    .frame(width: 96, height: 96)
            } else {
                MascotPlaceholder(mood: controller.mood, blinking: controller.blinking)
            }
        }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 3)
            // 이동량은 화면 좌표의 포인터로 잰다. 제스처의 `translation` 은 캐릭터 좌표계 기준이라,
            // 창이 따라 움직이는 동안 기준점도 같이 움직여 끌기가 떨린다.
            .onChanged { _ in
                let mouse = NSEvent.mouseLocation
                if dragStart == nil {
                    dragStart = (controller.panel.frame.origin, mouse)
                    controller.panel.setCharacterDragActive(true)
                }
                guard let dragStart else {
                    return
                }
                controller.panel.setFrameOrigin(NSPoint(
                    x: dragStart.panel.x + mouse.x - dragStart.mouse.x,
                    y: dragStart.panel.y + mouse.y - dragStart.mouse.y
                ))
            }
            .onEnded { _ in
                dragStart = nil
                controller.panel.setCharacterDragActive(false)
                controller.panel.saveFrame(usingName: "IdaeriMascotPanel")
            }
    }

    private var moodLabel: String {
        switch controller.mood {
        case .idle: return "쉬는 중"
        case .working: return "작업 중"
        case .awaitingApproval: return "승인 대기"
        case .failed: return "실패 확인 필요"
        }
    }

    @ViewBuilder
    private func bubbleView(_ bubble: MascotBubble) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            switch bubble {
            case let .notice(message):
                Text(message).lineLimit(4)
                HStack { Spacer(); Button("확인") { controller.clearNotice() } }
            case .commandInput:
                TextField(controller.commandPrompt, text: $commandText)
                    .focused($commandFieldFocused)
                    .onSubmit { submitCommand() }
                    .onAppear { commandFieldFocused = true }
                HStack {
                    Button("보내기") { submitCommand() }
                    Button("닫기") { closeCommandInput() }
                        .keyboardShortcut(.cancelAction)
                }
            case let .approval(id, headline, title, more, submitted, armed):
                Text(headline).font(.headline)
                Text(title).lineLimit(3)
                if more > 0 { Text("외 \(more)건").font(.caption) }
                HStack {
                    Button("승인") { controller.approve(id: id) }.disabled(submitted || !armed)
                    Button("자세히") { controller.showDashboard() }
                    Button("나중에") { controller.dismissApproval(id: id) }
                }
            case let .reply(message):
                Text(message).lineLimit(6)
                HStack { Spacer(); Button("닫기") { controller.closeReply() } }
            case let .briefing(lines):
                ForEach(lines, id: \.self) { line in Text(line) }
            case let .reaction(message):
                Text(message)
            }
        }
        .font(.system(size: 13))
        .foregroundColor(Color(nsColor: .labelColor))
        .padding(12)
        .background(Color(nsColor: .windowBackgroundColor).opacity(0.96), in: RoundedRectangle(cornerRadius: 14))
        // 꼬리는 아래 가운데에서 캐릭터를 가리킨다 — 누가 말하는지 보이게.
        .overlay(alignment: .bottom) {
            MascotBubbleTail()
                .fill(Color(nsColor: .windowBackgroundColor).opacity(0.96))
                .frame(width: 16, height: 9)
                .offset(y: 8)
        }
        .shadow(color: .black.opacity(0.18), radius: 8, y: 3)
        .accessibilityElement(children: .contain)
    }

    private func submitCommand() {
        let text = commandText
        controller.sendCommand(text)
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            commandText = ""
        }
    }

    private func closeCommandInput() {
        controller.closeCommandInput()
        commandText = ""
    }
}

/// 말풍선 아래로 내려오는 꼬리(아래를 향한 삼각형).
private struct MascotBubbleTail: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
