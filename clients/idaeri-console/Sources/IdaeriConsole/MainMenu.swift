import AppKit

/// 메뉴 바 구성.
///
/// `.app` 번들 없이 SwiftPM 실행 파일로 뜨는 구조라 macOS 가 기본 메뉴를 깔아주지 않는다
/// (지금까지 이 앱의 메뉴 바는 빈 채였다 — ⌘Q 도 없었다).
///
/// 여기에 「창을 도면 크기에 맞추기」를 두는 이유: 배율 계단이 창 크기에 대해 계단 함수라,
/// 창을 손으로 줄이거나 화면 절반에 타일링하면 요구치보다 1px 만 모자라도 도면이 절반 크기로
/// 떨어진다. 그 문턱을 사용자가 손으로 맞출 방법이 없었다 — 메뉴 항목이 유일한 입구다.
///
/// 여기에 "대표에게 지시"를 두는 이유: 씬 안의 대표를 클릭하는 경로는 마우스만 받는다.
/// `SpriteView` 는 접근성 트리에 이름 없는 이미지 하나로만 잡혀 자식을 `.ignore` 로 덮어 읽고,
/// 접근성 API 클릭은 SpriteKit 씬에 전달되지도 않는다(실측). 화면 위 버튼을 걷어낸 뒤로는
/// 이 메뉴 항목이 키보드·보조기술이 담당자 미지정 지시에 닿는 유일한 길이다.
/// - Returns: 메뉴 항목이 약하게 참조하는 액션 대상. 호출자가 앱 수명 동안 붙들어야 한다.
func installMainMenu(on application: NSApplication) -> MainMenuBridge {
    let bridge = MainMenuBridge()
    let mainMenu = NSMenu()

    // 첫 항목은 macOS 가 앱 메뉴로 취급한다.
    let applicationMenuItem = NSMenuItem()
    let applicationMenu = NSMenu(title: "이대리 콘솔")
    applicationMenu.addItem(
        withTitle: "이대리 콘솔 종료",
        action: #selector(NSApplication.terminate(_:)),
        keyEquivalent: "q"
    )
    applicationMenuItem.submenu = applicationMenu
    mainMenu.addItem(applicationMenuItem)

    let commandMenuItem = NSMenuItem()
    let commandMenu = NSMenu(title: "지시")
    let presidentMenuItem = NSMenuItem(
        title: "대표에게 지시…",
        action: #selector(MainMenuBridge.openPresidentCommand),
        keyEquivalent: "k"
    )
    presidentMenuItem.target = bridge
    presidentMenuItem.toolTip = "담당자를 지정하지 않는 지시를 보냅니다. 담당자는 이대리가 고릅니다."
    commandMenu.addItem(presidentMenuItem)
    commandMenuItem.submenu = commandMenu
    mainMenu.addItem(commandMenuItem)

    let viewMenuItem = NSMenuItem()
    let viewMenu = NSMenu(title: "보기")
    let fitMenuItem = NSMenuItem(
        title: "창을 도면 크기에 맞추기",
        action: #selector(MainMenuBridge.fitFrontWindowToFloorPlan),
        keyEquivalent: "0"
    )
    fitMenuItem.target = bridge
    fitMenuItem.toolTip =
        "이 화면에서 사무실 도면이 가장 큰 배율로 그려지는 크기로 창을 맞춥니다."
    viewMenu.addItem(fitMenuItem)
    viewMenuItem.submenu = viewMenu
    mainMenu.addItem(viewMenuItem)

    application.mainMenu = mainMenu
    return bridge
}

/// 메뉴 항목에서 앱 쪽으로 넘어가는 통로. `NSMenuItem` 은 `@objc` 셀렉터만 부를 수 있어
/// SwiftUI 상태를 직접 만지지 못하므로, 통지를 한 번 쏘고 `AppRootView` 가 받아 오피스 탭의
/// 지시 바를 연다. 창 크기는 SwiftUI 를 거치지 않으므로 여기서 바로 만진다.
final class MainMenuBridge: NSObject {
    @objc func openPresidentCommand() {
        NotificationCenter.default.post(name: .idaeriOpenPresidentCommand, object: nil)
    }

    /// 이름을 자유 함수(`fitWindowToFloorPlan(_:)`)와 다르게 둔다 — 같으면 모듈 한정자
    /// (`IdaeriConsole.`)를 빼는 순간 자기 자신을 부르는 무한 재귀가 된다.
    @objc func fitFrontWindowToFloorPlan() {
        guard let window = NSApp.keyWindow ?? NSApp.windows.first(where: { $0.isVisible }) else {
            return
        }
        fitWindowToFloorPlan(window)
    }
}

extension Notification.Name {
    /// 담당자 미지정 지시 바를 열라는 요청(메뉴 → 화면).
    static let idaeriOpenPresidentCommand = Notification.Name("idaeri.openPresidentCommand")
}
