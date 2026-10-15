import AppKit

/// 투명 영역은 아래 창으로 넘기고, 캐릭터와 말풍선만 마우스를 받는다.
/// 패널 전체가 클릭을 막으면 상시 표시가 다른 앱의 사용을 방해한다.
final class MascotPanel: NSPanel {
    private var interactiveRects: [CGRect] = []
    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var screenObserver: NSObjectProtocol?
    private var isCharacterDragActive = false
    private var isCommandInputActive = false

    override var canBecomeKey: Bool { true }

    init() {
        let size = NSSize(width: 340, height: 300)
        let visibleFrame = NSScreen.main?.visibleFrame ?? NSRect(origin: .zero, size: size)
        let origin = Self.defaultOrigin(size: size, visibleFrame: visibleFrame)
        super.init(
            contentRect: NSRect(origin: origin, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        ignoresMouseEvents = true
        setFrameAutosaveName("IdaeriMascotPanel")
        // 이름을 붙이는 것만으로는 저장된 위치를 읽어 오지 않는다. 끌어 놓은 자리를 재실행 뒤에도
        // 지키려면 명시적으로 읽는다. 저장값이 없으면 false 이고 위의 기본 위치가 그대로 남는다.
        setFrameUsingName("IdaeriMascotPanel")
        keepOnScreen()
        // 모니터를 빼면 그 화면에 있던 패널은 갈 곳을 잃는다. 테두리 없는 창은 시스템이 화면 안으로
        // 당겨 주지 않으므로 화면 구성이 바뀔 때마다 다시 확인한다.
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.keepOnScreen()
        }
        // 포인터가 다른 앱 위에 있어도 진입을 감지해야 하므로 전역 감시도 필요하다.
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] _ in
            self?.refreshMouseHit()
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] event in
            self?.refreshMouseHit()
            return event
        }
    }

    deinit {
        if let globalMonitor {
            NSEvent.removeMonitor(globalMonitor)
        }
        if let localMonitor {
            NSEvent.removeMonitor(localMonitor)
        }
        if let screenObserver {
            NotificationCenter.default.removeObserver(screenObserver)
        }
    }

    /// 캐릭터 그림 한 변. 화면(`MascotView`)과 화면 밖 검사가 같은 값을 쓴다.
    static let characterSide: CGFloat = 96
    /// 패널 가장자리와 내용 사이 여백. 캐릭터는 이만큼 아래 가장자리에서 떨어져 가운데에 선다.
    static let contentInset: CGFloat = 12

    /// 패널 안 캐릭터 칸의 화면 좌표. `MascotView` 가 캐릭터를 아래 가운데에 세우는 배치와 같다.
    private var characterFrameOnScreen: NSRect {
        NSRect(
            x: frame.midX - Self.characterSide / 2,
            y: frame.minY + Self.contentInset,
            width: Self.characterSide,
            height: Self.characterSide
        )
    }

    /// 캐릭터 칸이 지금 연결된 어느 화면 안에도 온전히 들어오지 않으면 기본 자리로 옮긴다.
    ///
    /// 패널 전체가 화면과 겹치는지만 보면 안 된다 — 패널은 340pt 인데 대부분 투명하고, 끌 수 있는
    /// 손잡이는 가운데 캐릭터뿐이다. 외부 모니터를 뺀 뒤 투명한 가장자리만 걸쳐 있으면 겹침은 참인데
    /// 캐릭터는 화면 밖이라 다시 끌어올 방법이 없다.
    private func keepOnScreen() {
        let character = characterFrameOnScreen
        guard !NSScreen.screens.contains(where: { $0.visibleFrame.contains(character) }),
              let visibleFrame = NSScreen.main?.visibleFrame
        else {
            return
        }
        setFrameOrigin(Self.defaultOrigin(size: frame.size, visibleFrame: visibleFrame))
    }

    private static func defaultOrigin(size: NSSize, visibleFrame: NSRect) -> NSPoint {
        NSPoint(x: visibleFrame.maxX - size.width - 16, y: visibleFrame.minY + 16)
    }

    func updateInteractiveRects(_ rects: [CGRect]) {
        interactiveRects = rects
        refreshMouseHit()
    }

    func setCharacterDragActive(_ active: Bool) {
        isCharacterDragActive = active
        refreshMouseHit()
    }

    func setCommandInputActive(_ active: Bool) {
        isCommandInputActive = active
        refreshMouseHit()
    }

    private func refreshMouseHit() {
        let point = convertPoint(fromScreen: NSEvent.mouseLocation)
        let hit = interactiveRects.contains { $0.contains(point) }
        ignoresMouseEvents = !(hit || isCharacterDragActive || isCommandInputActive)
    }
}
