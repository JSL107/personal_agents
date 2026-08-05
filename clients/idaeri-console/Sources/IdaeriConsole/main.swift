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
    // 창 크기를 넘길 수 있다 — `--size 980x680`.
    //
    // 타일 한 칸의 크기는 `min(너비 / 열, 높이 / 줄)` 이라 **창 비율에 따라 병목이 가로에서
    // 세로로 옮겨 간다.** 그래서 격자 규격을 바꾸면 어떤 창에서는 타일이 그대로이고 어떤
    // 창에서는 작아지는데, 렌더 크기가 한 값으로 고정돼 있으면 그 차이를 확인할 방법이 없다.
    // 기본값은 기존 회귀 캡처와 비교되도록 그대로 둔다.
    // 값을 읽는 규칙 자체는 `officeParseRenderSize`(ConsoleCore) 가 갖는다 — 여기 두면
    // 실행 파일 안이라 테스트로 고정할 수가 없다.
    let sizeIndex = CommandLine.arguments.firstIndex(of: "--size")
    let renderSize =
        sizeIndex.flatMap { index -> CGSize? in
            guard index + 1 < CommandLine.arguments.count,
                let parsed = officeParseRenderSize(CommandLine.arguments[index + 1])
            else {
                return nil
            }
            return CGSize(width: parsed.width, height: parsed.height)
        } ?? CGSize(width: 1400, height: 820)
    let succeeded = renderOfficeScene(
        client: client,
        path: outputPath,
        hour: hour,
        size: renderSize
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
