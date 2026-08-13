import AppKit

/// 메뉴 바 구성.
///
/// `.app` 번들 없이 SwiftPM 실행 파일로 뜨는 구조라 macOS 가 기본 메뉴를 깔아주지 않는다
/// (지금까지 이 앱의 메뉴 바는 빈 채였다 — ⌘Q 도 없었다).
///
/// 여기에 "대표에게 지시"를 두는 이유: 씬 안의 대표를 클릭하는 경로는 마우스만 받는다.
/// `SpriteView` 는 접근성 트리에 이름 없는 이미지 하나로만 잡혀 자식을 `.ignore` 로 덮어 읽고,
/// 접근성 API 클릭은 SpriteKit 씬에 전달되지도 않는다(실측). 화면 위 버튼을 걷어낸 뒤로는
/// 이 메뉴 항목이 키보드·보조기술이 담당자 미지정 지시에 닿는 유일한 길이다.
/// - Returns: 메뉴 항목이 약하게 참조하는 액션 대상. 호출자가 앱 수명 동안 붙들어야 한다.
func installMainMenu(on application: NSApplication) -> PresidentCommandMenuBridge {
    let bridge = PresidentCommandMenuBridge()
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
        action: #selector(PresidentCommandMenuBridge.openPresidentCommand),
        keyEquivalent: "k"
    )
    presidentMenuItem.target = bridge
    presidentMenuItem.toolTip = "담당자를 지정하지 않는 지시를 보냅니다. 담당자는 이대리가 고릅니다."
    commandMenu.addItem(presidentMenuItem)
    commandMenuItem.submenu = commandMenu
    mainMenu.addItem(commandMenuItem)

    application.mainMenu = mainMenu
    return bridge
}

/// 메뉴 항목에서 SwiftUI 뷰로 넘어가는 통로. `NSMenuItem` 은 `@objc` 셀렉터만 부를 수 있어
/// SwiftUI 상태를 직접 만지지 못하므로, 통지를 한 번 쏘고 `AppRootView` 가 받아 오피스 탭의
/// 지시 바를 연다.
final class PresidentCommandMenuBridge: NSObject {
    @objc func openPresidentCommand() {
        NotificationCenter.default.post(name: .idaeriOpenPresidentCommand, object: nil)
    }
}

extension Notification.Name {
    /// 담당자 미지정 지시 바를 열라는 요청(메뉴 → 화면).
    static let idaeriOpenPresidentCommand = Notification.Name("idaeri.openPresidentCommand")
}
