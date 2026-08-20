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

// 굽는 크기를 넘길 수 있다 — `--size 980x680`. 회귀 렌더와 스트림이 함께 쓴다.
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
    // 일반 앱 경로에는 닿지 않고, 회귀 렌더에서만 가구 자세 일곱 종류를 강제로 세운다.
    let poseDemo = CommandLine.arguments.contains("--pose-demo")
    // 호버 쪽지는 마우스가 있어야 뜨므로 렌더에 잡히지 않는다 — 그러면 "가려지는지" 를
    // 눈으로 확인할 방법이 사람이 앱을 띄우는 것뿐이다. 대상을 넘겨 강제로 띄운다.
    //   swift run IdaeriConsole --render /tmp/office.png --hover PO_EVAL
    let hoverIndex = CommandLine.arguments.firstIndex(of: "--hover")
    let hoverAgentType = hoverIndex.flatMap { index -> String? in
        guard index + 1 < CommandLine.arguments.count else {
            return nil
        }
        return CommandLine.arguments[index + 1]
    }
    // 상시 말풍선은 진행 중인 사람에게만 붙는데 평소 사무실은 0~2명뿐이라, 문패가 말풍선을
    // 덮는지 확인하려는 순간에 대상이 없다. 전원을 진행 중으로 세워 굽는다.
    //   swift run IdaeriConsole --render /tmp/office.png --busy-demo
    let busyDemo = CommandLine.arguments.contains("--busy-demo")
    // 대표 경고등은 승인 대기가 만료 임박까지 방치돼야 뜨는데, 실 백엔드는 지금(2026-08)
    // 승인 대기가 0건이라 기다려서는 확인할 방법이 없다. 승인 카드 하나를 TTL 83% 소진
    // 상태로 강제해 굽는다.
    //   swift run IdaeriConsole --render /tmp/office.png --alarm-demo
    let alarmDemo = CommandLine.arguments.contains("--alarm-demo")
    // 글자가 서로를 가리는지는 **그려진 글자 폭**에 달려 있어, 좌석 크기나 폰트 값을 비교하는
    // 단언으로는 안 잡힌다. 노드마다 이미 붙어 있는 이름(`agentType`)을 그림에 찍고 겹친
    // 상자만 빨갛게 칠한다 — 겹침이 보여도 그게 누구 것인지 그림에 없으면 어디를 고쳐야
    // 하는지 지목할 수가 없다. 같은 목록은 stderr 로도 나간다.
    //   swift run IdaeriConsole --render /tmp/office.png --busy-demo --labels
    let debugLabels = CommandLine.arguments.contains("--labels")
    // 할 일 말풍선과 연속 도장은 실 백엔드가 지금 승인 0건·연속 0일이라 화면에 뜨지 않는다.
    // 할 일 3종이 겹친 날과 연속 3일을 강제해 굽는다 — `--alarm-demo` 와 함께 쓰면 대표 머리
    // 위에 문패·경고등·말풍선이 한꺼번에 쌓이는 최악을 볼 수 있다.
    //   swift run IdaeriConsole --render /tmp/office.png --briefing-demo --alarm-demo
    let briefingDemo = CommandLine.arguments.contains("--briefing-demo")
    let succeeded = renderOfficeScene(
        client: client,
        path: outputPath,
        hour: hour,
        size: renderSize,
        poseDemo: poseDemo,
        hoverAgentType: hoverAgentType,
        busyDemo: busyDemo,
        alarmDemo: alarmDemo,
        briefingDemo: briefingDemo,
        debugLabels: debugLabels
    )
    exit(succeeded ? 0 : 1)
}

// 평면도 내보내기 — 다른 기기의 앱이 같은 배치를 그리도록 계산 결과를 JSON 으로 넘긴다.
//   swift run IdaeriConsole --layout-json /tmp/layout.json --zone-columns 3
if let layoutIndex = CommandLine.arguments.firstIndex(of: "--layout-json") {
    let outputPath =
        layoutIndex + 1 < CommandLine.arguments.count
        ? CommandLine.arguments[layoutIndex + 1] : "layout.json"
    // 창이 세로로 길면 부서를 2열×3행으로 세운다 — 화면이 정하는 값이라 부르는 쪽이 넘긴다.
    //
    // 잘못된 값은 **여기서 끊는다.** 그대로 넘기면 `officePlanSize` 의 precondition 에서
    // 죽어, 사용자가 보는 것이 오타를 알려주는 한 줄이 아니라 스택 트레이스가 된다.
    let zoneColumnsIndex = CommandLine.arguments.firstIndex(of: "--zone-columns")
    var zoneColumns = 3
    if let index = zoneColumnsIndex {
        let raw = index + 1 < CommandLine.arguments.count ? CommandLine.arguments[index + 1] : ""
        guard let parsed = officeParseZoneColumns(raw) else {
            FileHandle.standardError.write(
                Data("--zone-columns 는 2 또는 3 이어야 한다 (받은 값: \"\(raw)\")\n".utf8)
            )
            exit(1)
        }
        zoneColumns = parsed
    }
    exit(exportOfficeLayout(client: client, path: outputPath, zoneColumns: zoneColumns) ? 0 : 1)
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
