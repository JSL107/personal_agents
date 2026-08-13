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
    // 일반 앱 경로에는 닿지 않고, 회귀 렌더에서만 가구 자세 일곱 종류를 강제로 세운다.
    let poseDemo = CommandLine.arguments.contains("--pose-demo")
    let succeeded = renderOfficeScene(
        client: client,
        path: outputPath,
        hour: hour,
        size: renderSize,
        poseDemo: poseDemo
    )
    exit(succeeded ? 0 : 1)
}

// Dock 아이콘. `.app` 번들 없이 SwiftPM 실행 파일로 뜨는 구조라 macOS 가 아이콘을 찾을
// 곳이 없어 기본 실행파일 아이콘(검은 `exec`)이 붙는다. 번들을 만드는 대신 뜰 때 한 번
// 직접 물린다 — 번들 리소스라 개발 실행·배포 경로가 같다.
if let iconURL = Bundle.module.url(forResource: "appicon", withExtension: "png"),
    let icon = NSImage(contentsOf: iconURL)
{
    application.applicationIconImage = icon
}

// 메뉴 바. 대표에게 지시하는 입구가 여기 있다 — 자세한 이유는 MainMenu.swift.
// 브리지는 메뉴 항목이 약하게 참조하므로 앱이 사는 동안 여기서 붙들고 있어야 한다.
let menuBridge = installMainMenu(on: application)

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
