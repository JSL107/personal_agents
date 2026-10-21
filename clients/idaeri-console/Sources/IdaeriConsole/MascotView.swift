import AppKit
import ConsoleCore
import SwiftUI

enum MascotBubble: Equatable {
    case notice(String)
    case commandInput
    case status(header: [String], todos: [MascotTodoRow], busyCount: Int, notice: String?)
    case approval(id: String, headline: String, title: String, more: Int, submitted: Bool, armed: Bool)
    case thinking(String)
    case reply(sound: String, body: String, signature: String?, history: [MascotTurn])
    case briefing([String])
    case reaction(String)
    case chatter(sound: String, line: String, suggestion: MascotChatterSuggestion?, asks: Bool, showDashboard: Bool)
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
    @State private var replyText = ""
    @FocusState private var replyFieldFocused: Bool
    /// 숨쉬기 — 평소에 아주 천천히 위아래로 부푼다.
    @State private var breathing = false
    /// 마우스를 올리면 고개를 갸웃한다.
    @State private var hovering = false
    /// 이벤트 몸짓이 지금 더하는 값. 재생이 끝나면 0·1 로 돌아온다.
    @State private var hopOffset: CGFloat = 0
    @State private var shakeAngle: Double = 0
    @State private var squish: CGFloat = 0
    /// 좌우 둘러보기 — 그림을 뒤집어 반대쪽을 본다.
    @State private var facing: CGFloat = 1
    /// 지시를 기다리는 동안 통통 튀는 높이.
    @State private var bounce: CGFloat = 0
    /// 답장 본문의 실제 높이. 스크롤 영역을 이만큼(최대 180pt)만 잡는다.
    @State private var replyHeight: CGFloat = 0

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
            .padding(MascotPanel.contentInset)
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
        .frame(width: MascotPanel.size.width, height: MascotPanel.size.height)
    }

    private var character: some View {
        characterImage
            // 숨쉬기는 아래(발)를 기준으로 부풀어야 땅에 선 채 숨쉬는 것처럼 보인다.
            // 폭 1~2% 는 화면에서 거의 안 보였다. 눈에 띄되 출렁이지는 않는 3~4% 로 둔다.
            .scaleEffect(
                x: ((breathing ? 1.03 : 1) + squish) * facing,
                y: (breathing ? 0.965 : 1) - squish,
                anchor: .bottom
            )
            .rotationEffect(.degrees((hovering ? -5 : 0) + shakeAngle), anchor: .bottom)
            .offset(y: hopOffset + bounce)
            .onChange(of: controller.thinking) { _ in updateBounce() }
            .onChange(of: controller.activity) { _ in updateBounce() }
            .onAppear {
                withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) {
                    breathing = true
                }
                updateBounce()
            }
            .onHover { inside in
                withAnimation(.spring(response: 0.25, dampingFraction: 0.55)) {
                    hovering = inside
                }
            }
            .onChange(of: controller.motion) { motion in
                play(motion.kind)
            }
            // 지금 돌고 있는 일의 개수. 0 이면 숨긴다.
            // 그림 칸 바깥 오른쪽 옆구리에 둔다 — 칸 안 오른쪽 위는 그림의 `?`·반짝이 자리라 배지가 덮는다.
            .overlay(alignment: .trailing) {
                if controller.busyCount > 0 {
                    Text("\(controller.busyCount)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.orange, in: Capsule())
                        .fixedSize()
                        .offset(x: 22, y: -8)
                }
            }
            .contentShape(Rectangle())
            .accessibilityLabel("\(mascotName), \(moodLabel)")
            .onTapGesture(count: 2) { controller.openCommandInput() }
            .onTapGesture(count: 1) { controller.poke() }
            .gesture(dragGesture)
    }

    /// 지시를 기다리거나 소품을 들고 일하는 동안 통통 튄다 — "돌고 있다" 를 몸으로 보인다.
    /// 소품 그림은 한 장이라 그대로 두면 멈춘 그림처럼 보인다. 기다림은 크게, 일은 작고 느리게.
    private func updateBounce() {
        if controller.thinking {
            withAnimation(.easeInOut(duration: 0.32).repeatForever(autoreverses: true)) { bounce = -7 }
        } else if controller.activity != nil {
            withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) { bounce = -3 }
        } else {
            withAnimation(.easeOut(duration: 0.2)) { bounce = 0 }
        }
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
        case .lookAround:
            // 왼쪽을 보고, 잠깐 멈췄다 오른쪽으로 돌아온다.
            withAnimation(.easeInOut(duration: 0.15)) { facing = -1 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) {
                withAnimation(.easeInOut(duration: 0.15)) { facing = 1 }
            }
        case .sway:
            let angles: [Double] = [6, -6, 5, -4, 0]
            for (index, angle) in angles.enumerated() {
                DispatchQueue.main.asyncAfter(deadline: .now() + Double(index) * 0.18) {
                    withAnimation(.easeInOut(duration: 0.18)) { shakeAngle = angle }
                }
            }
        case .squish:
            withAnimation(.easeOut(duration: 0.08)) { squish = 0.12 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.4)) { squish = 0 }
            }
        }
    }

    private var poseContext: MascotPoseContext {
        MascotPoseContext(
            mood: controller.mood,
            blinking: controller.blinking,
            thinking: controller.thinking,
            reading: controller.isReading,
            hovering: hovering,
            dragging: dragStart != nil,
            flourish: controller.flourish,
            activity: controller.activity
        )
    }

    private var characterImage: some View {
        let context = poseContext
        let blinkBase = mascotPose(MascotPoseContext(mood: context.mood))
        let resolved = mascotResolvedFrames(mascotPose(context), blinkBase: blinkBase)
        return Group {
            if resolved.frames.count > 1 {
                // 여러 장이면 그 포즈를 보이는 동안에만 넘긴다. 한 장짜리 포즈에는 타이머가 없다.
                let interval = 1 / mascotFramesPerSecond(resolved.pose)
                TimelineView(.periodic(from: .now, by: interval)) { timeline in
                    let index = Int(timeline.date.timeIntervalSinceReferenceDate / interval) % resolved.frames.count
                    mascotFrameView(resolved.frames[index])
                }
            } else if let image = resolved.frames.first {
                mascotFrameView(image)
            } else {
                MascotPlaceholder(mood: controller.displayMood, blinking: controller.blinking)
            }
        }
    }

    private func mascotFrameView(_ image: NSImage) -> some View {
        Image(nsImage: image).resizable().interpolation(.high).scaledToFit()
            .frame(width: MascotPanel.characterSide, height: MascotPanel.characterSide)
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
            case let .status(header, todos, busyCount, notice):
                MascotStatusCard(
                    header: header, todos: todos, busyCount: busyCount, notice: notice,
                    onAction: { controller.perform($0) }, onClose: { controller.closeStatus() }
                )
            case let .thinking(line):
                MascotThinkingLine(text: line)
            case let .reply(sound, body, signature, history):
                Text(sound).font(.system(size: 14, weight: .bold))
                if !history.isEmpty {
                    // 패널 높이는 고정이다. 기록 4줄이 각각 두 줄로 접혀도 답장 입력 버튼이
                    // 캐릭터 뒤로 밀리지 않도록 기록과 본문에 각각 스크롤 높이 상한을 둔다.
                    ScrollView {
                        VStack(alignment: .leading, spacing: 3) {
                            ForEach(Array(history.suffix(4).enumerated()), id: \.offset) { _, turn in
                                Text("\(turn.role == .user ? "나" : "우사기"): \(turn.text)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .lineLimit(2)
                            }
                        }
                    }
                    .frame(height: min(CGFloat(min(history.count, 4)) * 32, 80))
                }
                // 긴 답은 잘라 버리지 않고 스크롤한다. 마크다운(굵게·기울임·코드)은 이대리 답이 실제로 쓴다.
                // 짧은 답은 내용 높이만큼만, 180pt 를 넘는 답만 스크롤한다. 높이 상한(`maxHeight`)만 걸면
                // 제안받은 높이를 다 차지해 말풍선 가운데가 크게 빈다 — 본문 높이를 재서 그만큼만 쓴다.
                ScrollView {
                    renderedReplyText(body)
                        .background(GeometryReader { geometry in
                            Color.clear.preference(key: MascotReplyHeight.self, value: geometry.size.height)
                        })
                }
                .frame(height: min(max(replyHeight, 18), history.isEmpty ? 180 : 72))
                .onPreferenceChange(MascotReplyHeight.self) { replyHeight = $0 }
                if let signature {
                    Text(signature).font(.caption).foregroundColor(.secondary)
                }
                TextField("이어서 말하기…", text: $replyText)
                    .focused($replyFieldFocused)
                    // 포커스가 빠지면 입력 상태도 푼다. 입력 중에 승인 말풍선이 답장을 밀어내면 칸이 사라지는데,
                    // 그대로 두면 패널의 투명한 빈 곳까지 클릭을 가로채 뒤의 앱이 눌리지 않는다.
                    .onChange(of: replyFieldFocused) { focused in
                        if focused {
                            controller.beginReplyTyping()
                        } else {
                            controller.endReplyTyping()
                        }
                    }
                    .onSubmit { submitReply() }
                HStack {
                    Spacer()
                    Button("보내기") { submitReply() }
                    Button("닫기") {
                        replyFieldFocused = false
                        replyText = ""
                        controller.closeReply()
                    }
                }
            case let .briefing(lines):
                ForEach(lines, id: \.self) { line in Text(line) }
            case let .reaction(message):
                Text(message)
            case let .chatter(sound, line, suggestion, asks, showDashboard):
                Text(sound).font(.system(size: 14, weight: .bold))
                Text(line).lineLimit(4)
                if showDashboard {
                    HStack {
                        Spacer()
                        Button("보기") { controller.perform(.openDashboard) }
                    }
                }
                if let suggestion {
                    Text("\(suggestion.displayName) 할까? — \(suggestion.reason)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(3)
                    HStack {
                        Spacer()
                        Button("해 줘") { controller.acceptChatter(suggestion) }
                        Button("나중에") { controller.declineChatter(suggestion) }
                    }
                }
                if asks {
                    HStack {
                        Spacer()
                        Button("답하기") {
                            controller.closeChatter()
                            controller.openCommandInput()
                        }
                        Button("닫기") { controller.closeChatter() }
                    }
                }
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

    private func renderedReplyText(_ body: String) -> some View {
        Text(mascotMarkdown(body))
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }

    private func submitCommand() {
        let text = commandText
        controller.sendCommand(text)
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            commandText = ""
        }
    }

    private func submitReply() {
        let text = replyText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return
        }
        controller.sendReply(text)
        replyText = ""
        replyFieldFocused = false
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

/// 답 본문을 마크다운으로 읽는다. 줄바꿈은 그대로 두고, 해석에 실패하면 원문을 쓴다.
private func mascotMarkdown(_ text: String) -> AttributedString {
    (try? AttributedString(
        markdown: text,
        options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    )) ?? AttributedString(text)
}

/// "생각 중" 한 줄 + 움직이는 점 세 개. 기다리는 동안에만 0.4초마다 다시 그린다.
private struct MascotThinkingLine: View {
    let text: String

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.4)) { context in
            let step = Int(context.date.timeIntervalSinceReferenceDate / 0.4) % 4
            Text(text + String(repeating: " ·", count: step))
                .frame(minWidth: 150, alignment: .leading)
        }
    }
}

private struct MascotReplyHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

/// 클릭하면 펼치는 할 일 목록 — 브리핑 머리 + 내가 처리할 일(승인·실패·PR) + 돌고 있는 일 수.
private struct MascotStatusCard: View {
    let header: [String]
    let todos: [MascotTodoRow]
    let busyCount: Int
    let notice: String?
    let onAction: (MascotTodoRow.Action) -> Void
    let onClose: () -> Void

    /// 패널 높이 안에 들어가는 줄 수. 넘치는 것은 "외 N개" 로 접는다(전체는 대시보드).
    private let maxRows = 6

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(header, id: \.self) { line in
                Text(line).font(.system(size: 12))
            }
            if !header.isEmpty {
                Divider()
            }
            if todos.isEmpty {
                Text("지금 내가 할 일은 없어요").font(.system(size: 12)).foregroundColor(.secondary)
            }
            ForEach(todos.prefix(maxRows)) { todo in
                row(todo)
            }
            if todos.count > maxRows {
                Button("외 \(todos.count - maxRows)개 — 대시보드에서 보기") { onAction(.openDashboard) }
                    .buttonStyle(.link)
                    .font(.caption)
            }
            if let notice {
                Text(notice).font(.caption).foregroundColor(.red).lineLimit(2)
            }
            HStack {
                Text(busyCount > 0 ? "지금 돌고 있는 일 \(busyCount)개" : "돌고 있는 일 없음")
                    .font(.caption).foregroundColor(.secondary)
                Spacer()
                Button("닫기", action: onClose)
            }
        }
        .frame(width: 276, alignment: .leading)
    }

    private func row(_ todo: MascotTodoRow) -> some View {
        HStack(spacing: 8) {
            Circle().fill(color(todo.kind)).frame(width: 7, height: 7)
            Image(systemName: icon(todo.kind)).font(.system(size: 11)).foregroundColor(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(todo.title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                Text(todo.detail).font(.system(size: 11)).foregroundColor(.secondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            if let action = todo.action {
                Button(buttonTitle(action)) { onAction(action) }
                    .controlSize(.small)
                    .disabled(todo.busy)
            }
        }
    }

    private func buttonTitle(_ action: MascotTodoRow.Action) -> String {
        switch action {
        case .openDashboard:
            return "열기"
        case .retry:
            return "재시도"
        case .openURL:
            return "PR"
        }
    }

    private func icon(_ kind: ConsoleTodoKind) -> String {
        switch kind {
        case .approval:
            return "checkmark.seal"
        case .failedRun:
            return "exclamationmark.triangle"
        case .prReview:
            return "arrow.triangle.pull"
        }
    }

    /// 승인은 주황, 실패는 빨강, PR 은 파랑.
    private func color(_ kind: ConsoleTodoKind) -> Color {
        switch kind {
        case .approval:
            return .orange
        case .failedRun:
            return .red
        case .prReview:
            return .blue
        }
    }
}
