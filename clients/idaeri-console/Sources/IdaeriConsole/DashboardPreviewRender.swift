import AppKit
import ConsoleCore
import SwiftUI

/// 백엔드 없이 개편된 대시보드를 PNG로 굽는 시각 회귀 입구.
/// 실제 화면과 같은 `DashboardView`를 써서 카드 조판·다크 모드·픽셀 에셋을 눈으로 확인한다.
func renderDashboardPreview(path: String, darkMode: Bool) -> Bool {
    let store = ConsoleStore()
    store.apply(
        snapshot: ConsoleSnapshot(
            agents: dashboardPreviewAgents,
            runs: [],
            approvals: [],
            sessions: [],
            serverTime: "2026-09-09T04:35:00.000Z"
        )
    )

    let dashboard = DashboardView(
        store: store,
        status: .live,
        baseURLLabel: "preview",
        onSend: { _, _ in },
        onApprove: { _ in },
        onReject: { _ in },
        onInject: { _, _ in .queued }
    )
    .environment(\.colorScheme, darkMode ? .dark : .light)
    .frame(width: 1280, height: 900)
    .background(Color(nsColor: .windowBackgroundColor))

    let hostingView = NSHostingView(rootView: dashboard)
    hostingView.appearance = NSAppearance(named: darkMode ? .darkAqua : .aqua)
    hostingView.frame = NSRect(x: 0, y: 0, width: 1280, height: 900)
    hostingView.layoutSubtreeIfNeeded()
    guard
        let bitmap = hostingView.bitmapImageRepForCachingDisplay(in: hostingView.bounds)
    else {
        return false
    }
    hostingView.cacheDisplay(in: hostingView.bounds, to: bitmap)
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        return false
    }
    do {
        try data.write(to: URL(fileURLWithPath: path))
        return true
    } catch {
        FileHandle.standardError.write(Data("대시보드 렌더 저장 실패: \(error)\n".utf8))
        return false
    }
}

private let dashboardPreviewAgents: [ConsoleAgent] = [
    ConsoleAgent(
        agentType: "PM", displayName: "PM", nickname: "김기획",
        slashCommands: ["/today"], description: "오늘 할 일", state: .waiting,
        bubble: "커피 한 잔, 오늘 업무를 기다려요", department: "planning",
        doneToday: 0, job: "오늘 할 일 목록과 우선순위를 정한다"
    ),
    ConsoleAgent(
        agentType: "CODE_REVIEWER", displayName: "Code Reviewer", nickname: "박꼼꼼",
        slashCommands: ["/review-pr"], description: "PR 코드 리뷰", state: .inProgress,
        bubble: "#536 리뷰 중", department: "quality", doneToday: 2,
        job: "PR을 리뷰하고 머지 가부를 판단한다"
    ),
    ConsoleAgent(
        agentType: "WORK_REVIEWER", displayName: "Work Reviewer", nickname: "정리나",
        slashCommands: ["/worklog"], description: "업무 리뷰", state: .waiting,
        bubble: "업무 대기중", department: "evaluation", doneToday: 0,
        job: "오늘 한 일을 업무 로그로 정리한다"
    ),
    ConsoleAgent(
        agentType: "HUMANIZER", displayName: "Humanizer", nickname: "윤다정",
        canDispatch: false,
        slashCommands: [], description: "윤문", state: .completed,
        bubble: "완료했어요!", lastFinishedRunId: "44", department: "content",
        doneToday: 3, job: "기계적인 문장을 사람이 쓴 글로 다듬는다"
    ),
    ConsoleAgent(
        agentType: "VACATION", displayName: "Vacation", nickname: "오휴가",
        slashCommands: ["/휴가"], description: "휴가 관리", state: .awaitingApproval,
        bubble: "확인해주세요", department: "internalOps", doneToday: 0,
        job: "연차 잔여일을 계산하고 사용을 기록한다"
    ),
    ConsoleAgent(
        agentType: "PAPER_TRADE", displayName: "Paper Trade", nickname: "백장부",
        slashCommands: [], description: "모의투자", state: .waiting,
        bubble: "업무 대기중", department: "treasury", doneToday: 1,
        job: "모의투자 계좌의 포지션과 일일 수익률을 평가한다"
    ),
]
