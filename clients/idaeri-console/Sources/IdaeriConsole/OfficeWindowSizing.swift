import AppKit
import ConsoleCore

/// 창 스타일. 타이틀바 높이를 재는 데도 쓰므로 창 생성부와 같은 값을 봐야 한다.
let windowStyleMask: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]

/// 창 세로 중 오피스 도면이 **쓰지 못하는** 부분(타이틀바 + 탭 전환 막대).
///
/// 타이틀바 높이를 상수로 적지 않는 이유는 스타일 마스크가 정하기 때문이다 — 지금 값은
/// 32px 이지만, 스타일을 바꾸면 상수 쪽만 남아 조용히 어긋난다. AppKit 에 직접 묻는다.
func officeWindowChromeHeight(styleMask: NSWindow.StyleMask) -> CGFloat {
    NSWindow.frameRect(forContentRect: .zero, styleMask: styleMask).height
        + Layout.tabHeaderHeight
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
    return NSSize(width: fit.width, height: CGFloat(fit.height) + Layout.tabHeaderHeight)
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
    var frame = NSRect(
        x: window.frame.minX,
        y: window.frame.maxY - frameSize.height,
        width: frameSize.width,
        height: frameSize.height
    )
    frame.origin.x = min(max(frame.origin.x, visible.minX), max(visible.maxX - frame.width, visible.minX))
    frame.origin.y = min(max(frame.origin.y, visible.minY), max(visible.maxY - frame.height, visible.minY))
    window.setFrame(frame, display: true, animate: true)
}
