import AppKit
import ConsoleCore
import SwiftUI

enum MascotBubble: Equatable {
    case notice(String)
    case commandInput
    case approval(id: String, headline: String, title: String, more: Int, submitted: Bool)
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

    var body: some View {
        GeometryReader { geometry in
            VStack(alignment: .trailing, spacing: 8) {
                Spacer(minLength: 0)
                if let bubble = controller.bubble {
                    bubbleView(bubble)
                        .frame(maxWidth: 300, alignment: .trailing)
                        .modifier(MascotHitArea())
                }
                character
                    .modifier(MascotHitArea())
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
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
        .contentShape(Rectangle())
        .accessibilityLabel("\(mascotName), \(moodLabel)")
        .onTapGesture(count: 2) { controller.openCommandInput() }
        .onTapGesture(count: 1) { controller.showBriefingNow() }
        .gesture(
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
        )
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
                TextField("무엇을 맡길까요?", text: $commandText)
                    .focused($commandFieldFocused)
                    .onSubmit { submitCommand() }
                    .onAppear { commandFieldFocused = true }
                HStack {
                    Button("보내기") { submitCommand() }
                    Button("닫기") { closeCommandInput() }
                        .keyboardShortcut(.cancelAction)
                }
            case let .approval(id, headline, title, more, submitted):
                Text(headline).font(.headline)
                Text(title).lineLimit(3)
                if more > 0 { Text("외 \(more)건").font(.caption) }
                HStack {
                    Button("승인") { controller.approve(id: id) }.disabled(submitted)
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
