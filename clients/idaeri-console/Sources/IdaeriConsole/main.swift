import AppKit
import ConsoleCore
import SwiftUI

// 콘솔 앱 부팅. NSApplication 을 코드로 띄운다(Xcode 프로젝트 불필요, CLT 전용 환경).
// 백엔드 주소는 IDAERI_CONSOLE_URL env 로 덮어쓸 수 있고, 기본은 로컬 이대리(PORT=3002).
let baseURLString = ProcessInfo.processInfo.environment["IDAERI_CONSOLE_URL"] ?? "http://127.0.0.1:3002"
let baseURL = URL(string: baseURLString) ?? URL(string: "http://127.0.0.1:3002")!
let client = ConsoleClient(baseURL: baseURL)

let application = NSApplication.shared
application.setActivationPolicy(.regular)

let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 980, height: 680),
    styleMask: [.titled, .closable, .miniaturizable, .resizable],
    backing: .buffered,
    defer: false
)
window.title = "이대리 콘솔"
window.center()
window.contentView = NSHostingView(
    rootView: AppRootView(client: client, baseURLLabel: baseURLString)
)
window.makeKeyAndOrderFront(nil)

application.activate(ignoringOtherApps: true)
application.run()
