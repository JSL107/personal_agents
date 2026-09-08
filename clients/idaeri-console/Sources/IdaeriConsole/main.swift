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

// 굽는 크기를 넘길 수 있다 — `--size 980×680`. 회귀 렌더와 스트림이 함께 쓴다.
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

// `--hour` 값. 없으면 nil(지금 시각), **있는데 못 읽으면 끊는다.**
//
// 조용히 기본값으로 물러서면 `--hour 2p` 같은 오타에서 낮 화면을 보고 밤을 확인한 줄 안다 —
// `--room`·`--zone-columns` 가 이미 같은 이유로 오타를 끊는다.
//
// 값을 읽는 규칙 자체는 `officeParseHour`(ConsoleCore) 가 갖는다 — 여기 두면 실행 파일 안이라
// 테스트로 고정할 수가 없다(`officeParseRenderSize` 와 같은 이유). 여기 남는 것은 인자를
// 찾아 끊는 일뿐이다.
func officeHourArgument() -> Int? {
    guard let index = CommandLine.arguments.firstIndex(of: "--hour") else {
        return nil
    }
    let raw = index + 1 < CommandLine.arguments.count ? CommandLine.arguments[index + 1] : ""
    guard let hour = officeParseHour(raw) else {
        FileHandle.standardError.write(
            Data("--hour 는 정수여야 한다 (받은 값: \"\(raw)\")\n".utf8)
        )
        exit(2)
    }
    return hour
}

// 화면 회귀 확인 모드 — 창을 띄우지 않고 사무실 한 장을 PNG 로 굽고 끝난다.
// 시각 변경이 실제로 화면에 나왔는지는 눈으로만 판정되는데, 확인 경로가 "앱을 띄우고
// 사람이 본다" 하나뿐이면 그 판정을 사람에게 매번 떠넘기게 된다.
//   swift run IdaeriConsole --render /tmp/office.png --hour 18
if let renderIndex = CommandLine.arguments.firstIndex(of: "--render") {
    let outputPath =
        renderIndex + 1 < CommandLine.arguments.count
        ? CommandLine.arguments[renderIndex + 1] : "office.png"
    let hour = officeHourArgument()
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
    // 방 하나만 확대해 굽는다. 방 6개는 격자 위치가 달라 한 방만 맞을 수 있어, 앱을 띄우지 않고
    // 여섯 장을 확인할 입구가 필요하다.
    //   swift run IdaeriConsole --render /tmp/office.png --room engineering
    let roomIndex = CommandLine.arguments.firstIndex(of: "--room")
    let room = roomIndex.flatMap { index -> Department? in
        guard index + 1 < CommandLine.arguments.count else {
            return nil
        }
        return officeParseDepartment(CommandLine.arguments[index + 1])
    }
    if roomIndex != nil, room == nil {
        let names = Department.allCases.map(\.rawValue).joined(separator: " · ")
        FileHandle.standardError.write(
            Data("--room 값을 알아볼 수 없다 — 쓸 수 있는 값: \(names)\n".utf8)
        )
        exit(2)
    }

    // 배회 대사는 8초 틱 뒤 걸음이 끝나야 뜨고, 마주친 대화의 답은 거기서 1.2초 더 늦다 —
    // 정지 렌더 한 장으로는 절대 만날 수 없다. 목적지를 가능한 만큼 채우고 전원에게 말을
    // 시켜 굽는다(겹침은 사람이 많을 때만 드러난다).
    //   swift run IdaeriConsole --render /tmp/office.png --chatter-demo
    let chatterDemo = CommandLine.arguments.contains("--chatter-demo")
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
        chatterDemo: chatterDemo,
        debugLabels: debugLabels,
        room: room
    )
    exit(succeeded ? 0 : 1)
}

// 색 회귀 게이트 — 렌더 픽셀에서 바닥 밝기를 재고 규칙을 어기면 exit 1.
//
// 톤이 어긋나도 아무도 모르는 자리를 메운다. 통로 누르기가 0.78 까지 올라가 복도가 벽보다
// 어두워졌을 때(실측 26.9 대 87.0) 파라미터 단언은 초록이었다 — 화면 밝기는 텍스처 밝기와
// 누르는 양의 곱이라 값끼리 비교해서는 순서를 알 수 없다.
//
// 낮(14시)과 밤(22시) 둘을 잰다. 시간대 조명 자체는 이 축에서 안 보이지만(화면 전체 평균이
// 2.6/255 만 움직인다 — 판정은 `OfficeIdleTests`), 나중에 밤 전용 색막 같은 것이 들어오면
// 바닥이 사람 밝기 아래로 가라앉는 것을 여기서 잡는다.
//   swift run IdaeriConsole --color-check [--hour 14] [--size 1440x860]
if CommandLine.arguments.contains("--color-check") {
    let hour = officeHourArgument()
    exit(officeCheckFloorColors(hours: hour.map { [$0] } ?? [14, 22], size: renderSize) ? 0 : 1)
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

// 창 기본 크기는 **도면 배율에서 거꾸로 잡는다.**
//
// 오피스 타일은 20px(레티나 실제 40px)의 정수배만 고를 수 있다 — 가구·캐릭터 원본이 40px 이라
// 1.5배 같은 값으로 그리면 도트가 뭉개진다. 그래서 창이 조금만 작아도 다음 계단으로 못 올라가고
// 최저 배율에 머문다. 예전 기본값 980×680 이 정확히 그랬다: 3열 배치로는 폭이, 2열로는 세로가
// 모자라 **어느 쪽으로도 20px** 이었고 화면 절반이 검은 여백이었다.
//
// 계산은 `officeWindowFit`(ConsoleCore)이 한다. 여기 상수 두 개(1440×860 · 960×1140)와
// `usableSize.width >= 1440` 한 줄로 고르던 때에는 세 가지가 새고 있었다 —
// 그 두 값이 맞는지 테스트할 수 없었고, `min(preferred, usable)` 로 자른 결과가 여전히 계단
// 위에 서는지 아무도 보지 않았으며, 두 값보다 큰 화면의 여유를 쓰지 못했다(2560×1349 는
// 60px 을 감당하는데 40px 로 떴다).
//
// **도면이 받는 세로는 창 세로가 아니다.** 타이틀바와 탭 전환 막대가 먼저 가져간다(합쳐 73px).
// 그만큼을 빼고 계산하지 않으면 계단 하나(40px)의 두 배 가까이 어긋난다.
let fallbackWindowSize = NSSize(width: 1440, height: 860)
let usableSize = NSScreen.main?.visibleFrame.size ?? fallbackWindowSize
// 한 계단도 못 들어가는 화면(폭 700 미만)이면 기본값으로 물러서되 **화면 안에 가둔다** —
// 예전 `min(preferred, usable)` 이 해 주던 몫이라, 빼면 작은 화면에서 창이 밖으로 넘친다.
let windowSize =
    officeWindowSizeFittingFloorPlan(
        usableSize: usableSize,
        backingScale: Double(NSScreen.main?.backingScaleFactor ?? 2),
        styleMask: windowStyleMask
    )
    ?? NSSize(
        width: min(fallbackWindowSize.width, usableSize.width),
        height: min(fallbackWindowSize.height, usableSize.height)
    )

let window = NSWindow(
    contentRect: NSRect(origin: .zero, size: windowSize),
    styleMask: windowStyleMask,
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
