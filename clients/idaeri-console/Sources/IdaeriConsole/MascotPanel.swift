import AppKit

/// 투명 영역은 아래 창으로 넘기고, 캐릭터와 말풍선만 마우스를 받는다.
/// 패널 전체가 클릭을 막으면 상시 표시가 다른 앱의 사용을 방해한다.
final class MascotPanel: NSPanel {
    private var interactiveRects: [CGRect] = []
    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var isCharacterDragActive = false
    private var isCommandInputActive = false

    override var canBecomeKey: Bool { true }

    init() {
        let size = NSSize(width: 340, height: 300)
        let visibleFrame = NSScreen.main?.visibleFrame ?? NSRect(origin: .zero, size: size)
        let origin = NSPoint(
            x: visibleFrame.maxX - size.width - 16,
            y: visibleFrame.minY + 16
        )
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
