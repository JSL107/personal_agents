import AppKit
import ConsoleCore
import SwiftUI

// 콘솔 앱 부팅. NSApplication 을 코드로 띄운다(Xcode 프로젝트 불필요, CLT 전용 환경).
// 백엔드 주소는 IDAERI_CONSOLE_URL env 로 덮어쓸 수 있고, 기본은 로컬 이대리(PORT=3002).
let baseURLString = ProcessInfo.processInfo.environment["IDAERI_CONSOLE_URL"] ?? "http://127.0.0.1:3002"
let baseURL = URL(string: baseURLString) ?? URL(string: "http://127.0.0.1:3002")!
let token = ProcessInfo.processInfo.environment["IDAERI_CONSOLE_TOKEN"]
let client = ConsoleClient(baseURL: baseURL, token: token)

let application = NSApplication.shared
application.setActivationPolicy(.regular)

// 화면 회귀 확인 모드 — 창을 띄우지 않고 사무실 한 장을 PNG 로 굽고 끝난다.
// 시각 변경이 실제로 화면에 나왔는지는 눈으로만 판정되는데, 확인 경로가 "앱을 띄우고
// 사람이 본다" 하나뿐이면 그 판정을 사람에게 매번 떠넘기게 된다.
//   swift run IdaeriConsole --render /tmp/office.png --hour 18
if let renderIndex = CommandLine.arguments.firstIndex(of: "--render") {
    let outputPath =
        renderIndex + 1 < CommandLine.arguments.count
        ? CommandLine.arguments[renderIndex + 1] : "office.png"
    let hourIndex = CommandLine.arguments.firstIndex(of: "--hour")
    let hour = hourIndex.flatMap { index -> Int? in
        guard index + 1 < CommandLine.arguments.count else {
            return nil
        }
        return Int(CommandLine.arguments[index + 1])
    }
    let succeeded = renderOfficeScene(
        client: client,
        path: outputPath,
        hour: hour,
        size: CGSize(width: 1400, height: 820)
    )
    exit(succeeded ? 0 : 1)
}

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
