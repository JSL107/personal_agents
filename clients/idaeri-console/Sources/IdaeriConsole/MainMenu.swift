import AppKit
import ConsoleCore

/// 메뉴 바 구성.
///
/// `.app` 번들 없이 SwiftPM 실행 파일로 뜨는 구조라 macOS 가 기본 메뉴를 깔아주지 않는다
/// (지금까지 이 앱의 메뉴 바는 빈 채였다 — ⌘Q 도 없었다).
///
/// 마스코트 더블클릭은 마우스만 받으므로, 담당자 미지정 지시를 키보드·보조기술에서도
/// 시작할 수 있도록 같은 입력창을 여는 메뉴 항목을 둔다.
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

    // ⌘C·⌘V·⌘A 는 이 메뉴의 단축키로만 응답 체인에 전달된다. 없으면 우사기 답을 선택해도 복사되지 않는다.
    // target 을 비워 두면 포커스된 텍스트(선택 가능한 Text·TextField)가 받는다.
    let editMenuItem = NSMenuItem()
    let editMenu = NSMenu(title: "편집")
    editMenu.addItem(withTitle: "실행 취소", action: Selector(("undo:")), keyEquivalent: "z")
    editMenu.addItem(withTitle: "실행 복귀", action: Selector(("redo:")), keyEquivalent: "Z")
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "오려두기", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: "복사하기", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: "붙여넣기", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    editMenu.addItem(withTitle: "전체 선택", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editMenuItem.submenu = editMenu
    mainMenu.addItem(editMenuItem)

    let commandMenuItem = NSMenuItem()
    let commandMenu = NSMenu(title: "지시")
    let mascotMenuItem = NSMenuItem(
        title: "\(mascotName)에게 지시…",
        action: #selector(MainMenuBridge.openMascotCommand),
        keyEquivalent: "k"
    )
    mascotMenuItem.target = bridge
    mascotMenuItem.toolTip = "담당자를 지정하지 않는 지시를 보냅니다. 담당자는 이대리가 고릅니다."
    commandMenu.addItem(mascotMenuItem)
    commandMenuItem.submenu = commandMenu
    mainMenu.addItem(commandMenuItem)

    application.mainMenu = mainMenu
    return bridge
}

/// 메뉴 항목에서 앱 쪽으로 넘어가는 통로. `NSMenuItem` 은 `@objc` 셀렉터만 부를 수 있어
/// SwiftUI 상태를 직접 만지지 못하므로, 통지를 한 번 쏘고 마스코트가 입력창을 연다.
final class MainMenuBridge: NSObject {
    @objc func openMascotCommand() {
        NotificationCenter.default.post(name: .idaeriOpenMascotCommand, object: nil)
    }
}

extension Notification.Name {
    /// 담당자 미지정 지시 입력창을 열라는 요청(메뉴 → 마스코트).
    static let idaeriOpenMascotCommand = Notification.Name("idaeri.openMascotCommand")

    /// 마스코트 지시도 기존 화면의 낙관적 전송·실패 처리 경로를 쓴다.
    static let idaeriMascotCommand = Notification.Name("idaeri.mascotCommand")

    /// 마스코트 제안 수락은 일반 자유 입력과 분리한다.
    static let idaeriMascotAcceptSuggestion = Notification.Name("idaeri.mascotAcceptSuggestion")

    /// 마스코트 할 일 목록의 [재시도]도 대시보드와 같은 재시도 경로를 쓴다.
    static let idaeriMascotRetry = Notification.Name("idaeri.mascotRetry")

    /// 마스코트의 승인 버튼도 기존 화면의 승인 처리 경로를 쓰게 한다.
    static let idaeriMascotApprove = Notification.Name("idaeri.mascotApprove")

    /// 마스코트에서 요청한 대시보드를 숨긴 메인 창과 함께 복원한다.
    static let idaeriShowDashboard = Notification.Name("idaeri.showDashboard")
}
