import AppKit

/// 메인 창을 닫아도 연결과 마스코트가 살아 있도록 창을 숨긴다.
/// Dock 에서 다시 열거나 마스코트에서 대시보드를 요청하면 같은 창을 복원한다.
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let window: NSWindow
    private var dashboardObserver: NSObjectProtocol?

    init(window: NSWindow) {
        self.window = window
        super.init()
        dashboardObserver = NotificationCenter.default.addObserver(
            forName: .idaeriShowDashboard,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.showMainWindow()
        }
    }

    deinit {
        if let dashboardObserver {
            NotificationCenter.default.removeObserver(dashboardObserver)
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    func applicationShouldHandleReopen(
        _ application: NSApplication,
        hasVisibleWindows: Bool
    ) -> Bool {
        showMainWindow()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ application: NSApplication) -> Bool {
        return false
    }

    private func showMainWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
