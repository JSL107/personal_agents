import AppKit
import ConsoleCore

/// 메뉴 바 구성.
///
/// `.app` 번들 없이 SwiftPM 실행 파일로 뜨는 구조라 macOS 가 기본 메뉴를 깔아주지 않는다
/// (지금까지 이 앱의 메뉴 바는 빈 채였다 — ⌘Q 도 없었다).
///
/// 여기에 「창을 도면 크기에 맞추기」를 두는 이유: 배율 계단이 창 크기에 대해 계단 함수라,
/// 창을 손으로 줄이거나 화면 절반에 타일링하면 요구치보다 1px 만 모자라도 도면이 절반 크기로
/// 떨어진다. 그 문턱을 사용자가 손으로 맞출 방법이 없었다 — 메뉴 항목이 유일한 입구다.
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
    // 3D 오피스(시험). 기본은 2D — 안정되면 기본값을 바꾸고 2D 를 걷어낸다(계획 4단계).
    let office3DMenuItem = NSMenuItem(
        title: "3D 오피스",
        action: #selector(MainMenuBridge.toggleOffice3D),
        keyEquivalent: ""
    )
    office3DMenuItem.target = bridge
    office3DMenuItem.toolTip = "오피스 화면을 3D(시험)로 그립니다. 다시 누르면 2D 로 돌아갑니다."
    viewMenu.addItem(office3DMenuItem)
    viewMenuItem.submenu = viewMenu
    mainMenu.addItem(viewMenuItem)

    application.mainMenu = mainMenu
    return bridge
}

/// 메뉴 항목에서 앱 쪽으로 넘어가는 통로. `NSMenuItem` 은 `@objc` 셀렉터만 부를 수 있어
/// SwiftUI 상태를 직접 만지지 못하므로, 통지를 한 번 쏘고 마스코트가 입력창을 연다.
/// 창 크기는 SwiftUI 를 거치지 않으므로 여기서 바로 만진다.
final class MainMenuBridge: NSObject, NSMenuItemValidation {
    @objc func openMascotCommand() {
        NotificationCenter.default.post(name: .idaeriOpenMascotCommand, object: nil)
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

extension MainMenuBridge {
    /// UserDefaults 만 바꾼다 — `OfficeView` 의 `@AppStorage` 가 그 변화를 받아 화면을 갈아 끼운다.
    @objc func toggleOffice3D() {
        let defaults = UserDefaults.standard
        let next = defaults.string(forKey: officeRendererDefaultsKey) == "3d" ? "2d" : "3d"
        defaults.set(next, forKey: officeRendererDefaultsKey)
    }

    /// 체크 표시는 메뉴를 열 때마다 저장값에서 읽는다 — 상태를 따로 들고 있으면 둘이 갈린다.
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(toggleOffice3D) {
            let on = UserDefaults.standard.string(forKey: officeRendererDefaultsKey) == "3d"
            menuItem.state = on ? .on : .off
        }
        return true
    }
}

extension Notification.Name {
    /// 담당자 미지정 지시 입력창을 열라는 요청(메뉴 → 마스코트).
    static let idaeriOpenMascotCommand = Notification.Name("idaeri.openMascotCommand")

    /// 마스코트 지시도 기존 화면의 낙관적 전송·실패 처리 경로를 쓴다.
    static let idaeriMascotCommand = Notification.Name("idaeri.mascotCommand")

    /// 마스코트 할 일 목록의 [재시도]도 대시보드와 같은 재시도 경로를 쓴다.
    static let idaeriMascotRetry = Notification.Name("idaeri.mascotRetry")

    /// 마스코트의 승인 버튼도 기존 화면의 승인 처리 경로를 쓰게 한다.
    static let idaeriMascotApprove = Notification.Name("idaeri.mascotApprove")

    /// 마스코트에서 요청한 대시보드를 숨긴 메인 창과 함께 복원한다.
    static let idaeriShowDashboard = Notification.Name("idaeri.showDashboard")
}
