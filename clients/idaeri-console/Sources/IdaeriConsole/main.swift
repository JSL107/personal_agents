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

// 보고서 목록 시각 회귀 렌더. 백엔드 없이 고정 fixture를 사용한다.
if let index = CommandLine.arguments.firstIndex(of: "--render-reports") {
    let path = index + 1 < CommandLine.arguments.count ? CommandLine.arguments[index + 1] : "reports.png"
    exit(renderReportsPreview(path: path) ? 0 : 1)
}

// 개인 사무실 카드 대시보드 시각 회귀 렌더. 백엔드 없이 고정 상태 6종을 한 장에 굽는다.
//   swift run IdaeriConsole --render-dashboard /tmp/dashboard.png [--dark] [--size 2560x1600] [--agents]
//   (`--agents` 는 대시보드 대신 에이전트 상태 탭을 굽는다)
if let renderIndex = CommandLine.arguments.firstIndex(of: "--render-dashboard") {
    let outputPath =
        renderIndex + 1 < CommandLine.arguments.count
        ? CommandLine.arguments[renderIndex + 1] : "dashboard.png"
    // 좁은 창과 넓은 창의 카드 조판을 같은 렌더 경로에서 확인한다.
    let dashboardSizeIndex = CommandLine.arguments.firstIndex(of: "--size")
    let dashboardRenderSize: CGSize? =
        dashboardSizeIndex.flatMap { index -> CGSize? in
            guard index + 1 < CommandLine.arguments.count,
                let parsed = officeParseRenderSize(CommandLine.arguments[index + 1])
            else {
                return nil
            }
            return CGSize(width: parsed.width, height: parsed.height)
        }
    exit(
        renderDashboardPreview(
            path: outputPath,
            darkMode: CommandLine.arguments.contains("--dark"),
            size: dashboardRenderSize,
            agentsTab: CommandLine.arguments.contains("--agents")
        ) ? 0 : 1
    )
}

// 캘린더 탭 시각 회귀 렌더. 백엔드 없이 고정 표본으로 한 장을 굽는다 — 빈 상태와 항목 있는
// 상태를 `--empty` 로 가른다(빈 상태가 탭의 초기 기본값이라 그쪽이 더 중요하다).
//   swift run IdaeriConsole --render-calendar /tmp/calendar.png [--empty] [--failure] [--loading] [--month 8] [--dark] [--size 720x900]
//
// `--size` 가 필요한 이유는 머리글이다 — 탭 막대가 고정 폭이 아니라 내용 크기로 자리를 잡으므로,
// 좁은 창(창 최소 폭 720)에서 머리글이 넘치는지는 그 폭으로 구워 보는 것 말고 확인할 방법이 없다.
// 값을 읽는 규칙은 대시보드 렌더와 같은 `officeParseRenderSize`(ConsoleCore)를 쓴다.
if let renderIndex = CommandLine.arguments.firstIndex(of: "--render-calendar") {
    let outputPath =
        renderIndex + 1 < CommandLine.arguments.count
        ? CommandLine.arguments[renderIndex + 1] : "calendar.png"
    let calendarSizeIndex = CommandLine.arguments.firstIndex(of: "--size")
    let calendarRenderSize: CGSize? =
        calendarSizeIndex.flatMap { index -> CGSize? in
            guard index + 1 < CommandLine.arguments.count,
                let parsed = officeParseRenderSize(CommandLine.arguments[index + 1])
            else {
                return nil
            }
            return CGSize(width: parsed.width, height: parsed.height)
        }
    exit(
        renderCalendarPreview(
            path: outputPath,
            darkMode: CommandLine.arguments.contains("--dark"),
            empty: CommandLine.arguments.contains("--empty"),
            // 조회 실패 화면은 백엔드를 실제로 죽이지 않는 한 렌더로 닿지 않는다 — 굽는 경로가
            // 응답을 기다리지 않고 끝나기 때문이다. 빈 상태와 갈라지는지 눈으로 보려면 세워야 한다.
            failure: CommandLine.arguments.contains("--failure"),
            // 조회 중 화면도 같은 이유로 렌더가 자연히 닿지 못한다 — 굽는 경로는 `.task` 의
            // 조회가 끝나기를 기다리지 않으므로 `isLoading` 은 항상 초기값(false)이다.
            // 빈 상태·실패와 셋이 갈라지는지는 세워서 구워 봐야 안다.
            loading: CommandLine.arguments.contains("--loading"),
            // 6주로 떨어지는 달(2026-08 등)은 5주 달과 조판 위험이 다르다 — 행이 하나 늘어
            // 창 하한에서 넘친다. 그 조판은 그 달을 굽지 않으면 확인할 방법이 없다.
            month: CommandLine.arguments.firstIndex(of: "--month")
                .flatMap { index -> Int? in
                    guard index + 1 < CommandLine.arguments.count else {
                        return nil
                    }
                    return Int(CommandLine.arguments[index + 1])
                } ?? 9,
            size: calendarRenderSize
        ) ? 0 : 1
    )
}

if let composeIndex = CommandLine.arguments.firstIndex(of: "--render-schedule-compose") {
    let outputPath =
        composeIndex + 1 < CommandLine.arguments.count
        ? CommandLine.arguments[composeIndex + 1] : "schedule-compose.png"
    exit(
        renderScheduleComposePreview(
            path: outputPath,
            darkMode: CommandLine.arguments.contains("--dark"),
            // 긴 제목·여러 줄 메모가 든 폼. 빈 폼만으로는 넘침 조판을 볼 수 없다.
            filled: CommandLine.arguments.contains("--filled"),
            // 등록 실패로 폼이 열린 채 사유를 띄운 화면.
            failure: CommandLine.arguments.contains("--failure"),
            // 길이 상한을 넘겨 등록이 막힌 화면 — 안내가 어느 칸에 붙는지는 굽어야 보인다.
            overflow: CommandLine.arguments.contains("--overflow")
        ) ? 0 : 1
    )
}

if CommandLine.arguments.contains("--asset-check") {
    exit(runCozyAssetCheck() ? 0 : 1)
}

// 투명 여백 잘라내기의 계약(몸 경계 보존·여백 유지·여백 상한)을 고정한다. `ConsoleCoreTests`
// 는 `ConsoleCore` 타깃만 의존해 `SpriteLoader` 를 밟지 않으므로, 이 경로는 여기서 잰다.
//   swift run IdaeriConsole --crop-check
if CommandLine.arguments.contains("--crop-check") {
    exit(runCozyCropCheck() ? 0 : 1)
}

// 워밍이 실제로 캐시를 채우는지 본다. 워밍은 눈에 보이지 않는 최적화라 조용히 죽어도 화면은
// 그대로이고(준비가 렌더 스레드로 되돌아가 느려질 뿐), 다른 게이트는 그것을 알려주지 않는다.
//   swift run IdaeriConsole --prewarm-check
if CommandLine.arguments.contains("--prewarm-check") {
    // 검사가 캐시를 만지므로 `@MainActor` 다. `main.swift` 의 top-level 은 Swift 5 모드에서
    // 논-아이솔레이티드라 그대로는 못 부른다 — 실제로 메인 스레드인 이 자리에서 격리를 명시한다.
    exit(MainActor.assumeIsolated { runCozyPrewarmCheck() } ? 0 : 1)
}

// Dock 아이콘. `.app` 번들 없이 SwiftPM 실행 파일로 뜨는 구조라 macOS 가 아이콘을 찾을
// 곳이 없어 기본 실행파일 아이콘(검은 `exec`)이 붙는다. 번들을 만드는 대신 뜰 때 한 번
// 직접 물린다 — 번들 리소스라 개발 실행·배포 경로가 같다.
if let iconURL = Bundle.module.url(forResource: "appicon", withExtension: "png"),
    let icon = NSImage(contentsOf: iconURL)
{
    application.applicationIconImage = icon
}

// 메뉴 바. 마스코트에게 지시하는 키보드 입구가 여기 있다 — 자세한 이유는 MainMenu.swift.
// 브리지는 메뉴 항목이 약하게 참조하므로 앱이 사는 동안 여기서 붙들고 있어야 한다.
let menuBridge = installMainMenu(on: application)

// 남은 탭의 최소 크기보다 여유 있는 기본 창. 작은 화면에서는 보이는 영역에 맞춘다.
let fallbackWindowSize = NSSize(width: 1100, height: 760)
let usableSize = NSScreen.main?.visibleFrame.size ?? fallbackWindowSize
let windowSize = NSSize(
    width: min(fallbackWindowSize.width, usableSize.width),
    height: min(fallbackWindowSize.height, usableSize.height)
)
let windowStyleMask: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]

let window = NSWindow(
    contentRect: NSRect(origin: .zero, size: windowSize),
    styleMask: windowStyleMask,
    backing: .buffered,
    defer: false
)
// 창을 닫아도 콘솔 동기화와 마스코트 승인이 이어져야 하므로 둘이 같은 store를 사용한다.
let store = ConsoleStore()
let appDelegate = AppDelegate(window: window)
application.delegate = appDelegate
window.delegate = appDelegate
window.title = "이대리 콘솔"
window.center()
window.contentView = NSHostingView(
    rootView: AppRootView(client: client, baseURLLabel: baseURLString, store: store)
)
window.makeKeyAndOrderFront(nil)
// Swift 5 최상위 코드는 actor 비격리지만 이 실행 지점은 AppKit 메인 스레드다.
let mascot = MainActor.assumeIsolated { () -> MascotController in
    let controller = MascotController(store: store)
    controller.show()
    return controller
}

application.activate(ignoringOtherApps: true)
application.run()
