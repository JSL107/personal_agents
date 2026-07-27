import AppKit
import SwiftUI
import ConsoleCore

// B1 스파이크: CLT 전용 환경에서 SwiftPM 이 SwiftUI + AppKit 창 앱을 빌드·링크·기동할 수
// 있는지 실증하는 최소 실행 타깃. NSApplication 을 코드로 띄운다(Xcode 프로젝트 불필요).
struct RootView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("이대리 콘솔")
                .font(.largeTitle)
                .bold()
            Text(ConsoleCore.name)
                .foregroundStyle(.secondary)
            Text("Phase 1 관제 대시보드가 여기에 들어온다")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.regular)

let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 900, height: 640),
    styleMask: [.titled, .closable, .miniaturizable, .resizable],
    backing: .buffered,
    defer: false
)
window.title = "이대리 콘솔"
window.center()
window.contentView = NSHostingView(rootView: RootView())
window.makeKeyAndOrderFront(nil)

application.activate(ignoringOtherApps: true)
application.run()
