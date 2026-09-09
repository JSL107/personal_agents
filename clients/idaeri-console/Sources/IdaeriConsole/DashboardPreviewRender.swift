import AppKit
import ConsoleCore
import SwiftUI

/// 백엔드 없이 개편된 대시보드를 PNG로 굽는 시각 회귀 입구.
/// 실제 화면과 같은 `DashboardView`를 써서 카드 조판·다크 모드·벡터 초상화를 눈으로 확인한다.
///
/// **캔버스가 실제 창보다 세로로 길다(1280×2000).** 대시보드는 ScrollView 라서 창 높이를
/// 넘는 부분은 PNG 에 아예 안 담긴다 — 승인 패널·세션 패널이 카드 격자 아래에 있어서,
/// 창 크기(900)로 굽던 동안 그 두 패널은 한 번도 렌더된 적이 없었다. 안 그리는 요소는
/// "정상" 으로 보이므로, 그리드 아래까지 프레임에 들어오는 높이로 굽는다.
/// 카드 폭(=열 수)은 1280 그대로라 카드 조판 자체는 실제 창과 같다.
private let dashboardPreviewSize = CGSize(width: 1280, height: 2000)

func renderDashboardPreview(path: String, darkMode: Bool) -> Bool {
    let store = ConsoleStore()
    store.apply(
        snapshot: ConsoleSnapshot(
            agents: dashboardPreviewAgents,
            // runs 는 대시보드가 안 쓴다(오피스 탭 전용) — 비워 둬도 사각지대가 아니다.
            runs: [],
            approvals: dashboardPreviewApprovals,
            sessions: dashboardPreviewSessions,
            serverTime: "2026-09-09T04:35:00.000Z"
        )
    )
    // 지시 배지는 스냅샷이 아니라 사용자 조작으로 쌓인다 — 굽는 쪽에서 직접 세워야
    // `pendingBadgeRow` 가 프레임에 들어온다(전송 중 · 전송 실패 두 모양).
    store.enqueueCommand(text: "owner/repo#42 리뷰해줘", agentTypeHint: "CODE_REVIEWER")
    store.markCommandFailed(
        id: store.enqueueCommand(text: "오늘 할 일 알려줘", agentTypeHint: "PM")
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
    .frame(width: dashboardPreviewSize.width, height: dashboardPreviewSize.height)
    .background(Color(nsColor: .windowBackgroundColor))

    let hostingView = NSHostingView(rootView: dashboard)
    hostingView.appearance = NSAppearance(named: darkMode ? .darkAqua : .aqua)
    hostingView.frame = NSRect(origin: .zero, size: dashboardPreviewSize)
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
        slashCommands: [], description: "모의투자", state: .failed,
        bubble: "연동에 실패했어요", department: "treasury", doneToday: 1,
        job: "모의투자 계좌의 포지션과 일일 수익률을 평가한다"
    ),
    // 연동 대기 한 명 — 그리드 위 경고 배너(`bottleneckBanner`)를 프레임에 세운다.
    // 이 배너 문구는 담당자 개편에서 "부서" → "담당자" 로 바뀌었는데, 표본에 이 상태가
    // 없던 동안에는 문구가 틀려도 렌더로 드러나지 않았다.
    ConsoleAgent(
        agentType: "CAREER_MATE", displayName: "Career Mate", nickname: "강성장",
        slashCommands: [], description: "역량 프로필", state: .awaitingIntegration,
        bubble: "연동을 기다려요", department: "content", doneToday: 0,
        job: "이직용 역량 프로필과 이력서를 모아 둔다"
    ),
]

/// 승인 대기 1건 — 없으면 승인/거절 버튼(`approvalPanel`)이 렌더에 아예 안 나온다.
/// 이 두 버튼은 #187 에서 눌려도 아무 일이 없던 자리다.
private let dashboardPreviewApprovals: [ConsoleApproval] = [
    ConsoleApproval(
        id: "preview-approval-1",
        agentType: "VACATION",
        title: "9월 12일 연차 1일 사용을 기록할까요?",
        createdAt: "2026-09-09T04:20:00.000Z",
        expiresAt: "2026-09-09T05:20:00.000Z"
    )
]

/// 로컬 세션 1건 — 세션 패널(`sessionPanel`)을 프레임에 세운다.
private let dashboardPreviewSessions: [ConsoleSession] = [
    ConsoleSession(
        sessionId: "preview-session-1",
        pid: 4242,
        source: "CLAUDE_CODE",
        name: "feat/friendly-agent-dashboard",
        cwd: "~/Desktop/backend/personal_agents",
        state: "ACTIVE",
        startedAt: "2026-09-09T03:50:00.000Z",
        lastActivityAt: "2026-09-09T04:34:00.000Z"
    )
]
