import AppKit
import ConsoleCore

/// 창 스타일. 타이틀바 높이를 재는 데도 쓰므로 창 생성부와 같은 값을 봐야 한다.
let windowStyleMask: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]

/// 타이틀바 높이. 상수로 적지 않는 이유는 스타일 마스크가 정하기 때문이다 — 지금 값은
/// 32px 이지만, 스타일을 바꾸면 상수 쪽만 남아 조용히 어긋난다. AppKit 에 직접 묻는다.
func officeTitleBarHeight(styleMask: NSWindow.StyleMask) -> CGFloat {
    NSWindow.frameRect(forContentRect: .zero, styleMask: styleMask).height
}

/// 창 세로 중 오피스 도면이 **쓰지 못하는** 부분(타이틀바 + 탭 전환 막대).
func officeWindowChromeHeight(styleMask: NSWindow.StyleMask) -> CGFloat {
    officeTitleBarHeight(styleMask: styleMask) + Layout.tabHeaderHeight
}

/// 이 화면에서 도면이 가장 큰 배율 계단에 서는 **창 내용(contentRect) 크기**.
///
/// `officeWindowFit` 은 오피스 뷰만 계산하므로, 여기서 탭 막대를 도로 더해 창 크기로 옮긴다.
/// 창 기본값과 메뉴의 「창을 도면 크기에 맞추기」가 같은 답을 내야 해서 한 곳에 둔다.
///
/// - Returns: 한 계단도 못 들어가는 화면이면 `nil`.
func officeWindowSizeFittingFloorPlan(
    usableSize: NSSize,
    backingScale: Double,
    styleMask: NSWindow.StyleMask
) -> NSSize? {
    let chromeHeight = officeWindowChromeHeight(styleMask: styleMask)
    guard
        let fit = officeWindowFit(
            availableWidth: Double(usableSize.width),
            availableHeight: Double(usableSize.height - chromeHeight),
            backingScale: backingScale
        )
    else {
        return nil
    }
    // **앱 최소 크기 아래로는 내려가지 않는다.** 20px 계단밖에 못 담는 화면에서는 3열 도면이
    // 700×400 이라 창 내용이 700×441 이 되는데, 루트 뷰는 720×560 을 요구한다(`AppRootView`).
    // 그대로 두면 SwiftUI 내용이 창 밖으로 밀린다 — 1366×768 · 1280×800 이 그 크기다.
    // 예전 경로는 상수(1440×860 · 960×1140)가 최소보다 커서 이 구멍을 겪지 않았다.
    // 도면은 뷰 가운데에 놓이므로 창이 도면보다 커도 여백이 생길 뿐 배율은 그대로다.
    let contentHeight = CGFloat(fit.height) + Layout.tabHeaderHeight
    let maxContentHeight = usableSize.height - officeTitleBarHeight(styleMask: styleMask)
    return NSSize(
        width: min(max(CGFloat(fit.width), Layout.windowMinWidth), usableSize.width),
        height: min(max(contentHeight, Layout.windowMinHeight), maxContentHeight)
    )
}

/// 지금 창을 도면 크기에 맞춘다 — 창이 놓인 화면에서 가능한 가장 큰 배율 계단으로.
///
/// 이 명령이 필요한 이유는 **배율 계단이 창 크기에 대해 계단 함수**이기 때문이다. 창을 손으로
/// 줄이거나 macOS 타일링으로 화면 절반에 붙이면 요구치보다 1px 만 모자라도 도면이 통째로
/// 절반 크기가 되는데, 화면에는 "가운데 작은 도면 + 검은 여백" 으로만 보여 원인이 창 크기라는
/// 신호가 없다. 사용자가 스스로 그 크기를 맞출 방법도 없었다(2026-09-07 신고).
///
/// 창 **왼쪽 위**를 고정한 채 키운다 — 세로 모니터 위쪽에 붙여 쓰는 배치에서 창이 위로 자라면
/// 화면 밖으로 나가고, `center()` 로 옮기면 사용자가 둔 자리를 뺏는다.
func fitWindowToFloorPlan(_ window: NSWindow) {
    guard let screen = window.screen ?? NSScreen.main,
        let contentSize = officeWindowSizeFittingFloorPlan(
            usableSize: screen.visibleFrame.size,
            backingScale: Double(window.backingScaleFactor),
            styleMask: window.styleMask
        )
    else {
        return
    }
    let visible = screen.visibleFrame
    let frameSize = window.frameRect(
        forContentRect: NSRect(origin: .zero, size: contentSize)
    ).size
    // 자리잡기(왼쪽 위 고정 + 화면 안 가두기)는 순수 함수가 한다 — AppKit 을 띄우지 않고
    // 테스트할 수 있는 유일한 조각이고, 실제로 틀리기 쉬운 곳도 여기다.
    let fitted = officeFittedWindowFrame(
        currentFrame: OfficeRect(
            x: Double(window.frame.minX), y: Double(window.frame.minY),
            width: Double(window.frame.width), height: Double(window.frame.height)
        ),
        fittedWidth: Double(frameSize.width),
        fittedHeight: Double(frameSize.height),
        visibleFrame: OfficeRect(
            x: Double(visible.minX), y: Double(visible.minY),
            width: Double(visible.width), height: Double(visible.height)
        )
    )
    window.setFrame(
        NSRect(x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height),
        display: true, animate: true
    )
}
