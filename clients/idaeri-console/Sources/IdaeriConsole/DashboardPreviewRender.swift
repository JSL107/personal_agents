import AppKit
import ConsoleCore
import SwiftUI

/// 백엔드 없이 개편된 대시보드를 PNG로 굽는 시각 회귀 입구.
/// 실제 화면과 같은 `DashboardView`를 써서 카드 조판·다크 모드·벡터 초상화를 눈으로 확인한다.
///
/// **콘텐츠 끝에 맞춘 캔버스(1280×1500).** 대시보드는 ScrollView 라서 창 높이를
/// 넘는 부분은 PNG 에 아예 안 담긴다 — 승인 패널·세션 패널이 카드 격자 아래에 있어서,
/// 창 크기(900)로 굽던 동안 그 두 패널은 한 번도 렌더된 적이 없었다. 반대로 2000pt까지
/// 무작정 늘리면 세션 패널 뒤에 빈 여백만 700pt 이상 남는다. 고정 표본(7 카드·승인 1건·
/// 세션 1건)의 마지막 패널 아래 32pt 여백까지만 담아, 실제 콘텐츠가 PNG 끝에 오도록 한다.
/// 카드 폭(=열 수)은 1280 그대로라 카드 조판 자체는 실제 창과 같다.
private let dashboardPreviewSize = CGSize(width: 1280, height: 1500)

/// `size` 를 생략하면(nil) 기존 회귀 캡처와 그대로 비교되도록 위 고정값을 쓴다.
/// 넓은 창에서 카드 안 캐릭터·소품이 잘리는지는 폭을 바꿔 구워야만 눈으로 확인할 수 있어
/// 호출부(`--render-dashboard --size`)가 넘길 수 있게 열어 둔다.
func renderDashboardPreview(
    path: String, darkMode: Bool, size: CGSize? = nil, agentsTab: Bool = false
) -> Bool {
    let dashboardPreviewSize = size ?? dashboardPreviewSize
    let store = ConsoleStore()
    store.apply(
        snapshot: ConsoleSnapshot(
            agents: dashboardPreviewAgents,
            // 진행 중 1건 — 대시보드의 "진행 중인 작업" 숫자와 "n분 전 시작" 이 이 값을 읽는다.
            runs: [
                ConsoleRun(
                    id: "120", agentType: "CODE_REVIEWER", status: "IN_PROGRESS", parentId: nil,
                    participants: [], startedAt: "2026-09-09T04:33:00.000Z", finishedAt: nil
                )
            ],
            approvals: dashboardPreviewApprovals,
            sessions: dashboardPreviewSessions,
            serverTime: "2026-09-09T04:35:00.000Z"
        )
    )
    store.apply(activity: dashboardPreviewActivity)
    store.apply(ledger: dashboardPreviewLedger)
    // 지시 배지는 스냅샷이 아니라 사용자 조작으로 쌓인다 — 굽는 쪽에서 직접 세워야
    // `pendingBadgeRow` 가 프레임에 들어온다(전송 중 · 전송 실패 두 모양).
    store.enqueueCommand(text: "owner/repo#42 리뷰해줘", agentTypeHint: "CODE_REVIEWER")
    store.markCommandFailed(
        id: store.enqueueCommand(text: "오늘 할 일 알려줘", agentTypeHint: "PM")
    )

    let dashboard = Group {
        if agentsTab {
            AgentStatusView(
                store: store,
                status: .live,
                baseURLLabel: "preview",
                onSend: { _, _ in }
            )
        } else {
            DashboardView(
                store: store,
                status: .live,
                baseURLLabel: "preview",
                onApprove: { _ in },
                onReject: { _ in },
                onInject: { _, _ in .queued },
                onShowAgents: {}
            )
        }
    }
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

// `private` 이 아닌 것은 워밍 검사(`runCozyPrewarmCheck`)가 이 명단을 재사용하기 때문이다 —
// `ConsoleAgent` 는 필드가 많아 검사용 인스턴스를 따로 만들면 실제와 어긋나기 쉽다.
let dashboardPreviewAgents: [ConsoleAgent] = [
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

/// 원장 표본 — 대기 중인 WORK_REVIEWER 가 정지라 「지금 담당자」 넷째 자리로 올라와야 한다.
/// CTO 는 명단에 없는 폐지 워커(2026-10-08 실측 값)라 정지여도 카드가 생기면 안 된다.
private let dashboardPreviewLedger = ConsoleLedger(
    agents: [
        ConsoleAgentLedger(
            agentType: "WORK_REVIEWER", firstRunDate: "2026-06-23", totalRuns: 174, failedRuns: 14,
            lastRunAt: "2026-08-30T00:17:13.703Z", autonomy: "AUTONOMOUS", stalled: true,
            idleDays: 10, autonomyIdleDays: 10
        ),
        ConsoleAgentLedger(
            agentType: "CTO", firstRunDate: "2026-07-01", totalRuns: 26, failedRuns: 0,
            lastRunAt: "2026-09-06T04:00:00.108Z", autonomy: "AUTONOMOUS", stalled: true,
            idleDays: 32, autonomyIdleDays: 32
        ),
    ],
    serverTime: "2026-09-09T04:35:00.000Z"
)

/// 14일 추이 표본 — 실패가 섞인 날, 실행이 없는 날(주말), 진행 중이 남은 오늘을 모두 담는다.
private let dashboardPreviewActivity = ConsoleActivity(
    days: [
        ("2026-08-27", 21, 2, 0), ("2026-08-28", 18, 1, 0), ("2026-08-29", 4, 0, 0),
        ("2026-08-30", 0, 0, 0), ("2026-08-31", 25, 3, 1), ("2026-09-01", 22, 0, 0),
        ("2026-09-02", 19, 5, 0), ("2026-09-03", 23, 1, 0), ("2026-09-04", 17, 2, 0),
        ("2026-09-05", 3, 0, 0), ("2026-09-06", 2, 1, 0), ("2026-09-07", 24, 2, 0),
        ("2026-09-08", 20, 4, 0), ("2026-09-09", 9, 1, 2),
    ].map { ConsoleActivityDay(date: $0.0, succeeded: $0.1, failed: $0.2, other: $0.3) },
    recentRuns: [
        ConsoleRecentRun(
            id: "120", agentType: "CODE_REVIEWER", status: "IN_PROGRESS", title: "#536 리뷰",
            startedAt: "2026-09-09T04:33:00.000Z", finishedAt: nil
        ),
        ConsoleRecentRun(
            id: "119", agentType: "HUMANIZER", status: "SUCCEEDED", title: "문장 다듬기",
            startedAt: "2026-09-09T04:20:00.000Z", finishedAt: "2026-09-09T04:22:00.000Z"
        ),
        ConsoleRecentRun(
            id: "118", agentType: "PAPER_TRADE", status: "SUCCEEDED", title: "장중 손절 점검",
            startedAt: "2026-09-09T04:00:00.000Z", finishedAt: "2026-09-09T04:05:00.000Z",
            count: 7
        ),
        ConsoleRecentRun(
            id: "117", agentType: "PM", status: "SUCCEEDED", title: "아침 계획 짜기",
            startedAt: "2026-09-09T00:00:00.000Z", finishedAt: "2026-09-09T00:02:00.000Z"
        ),
        ConsoleRecentRun(
            id: "116", agentType: "WORK_REVIEWER", status: "SUCCEEDED", title: "오늘 일 정리",
            startedAt: "2026-09-08T14:00:00.000Z", finishedAt: "2026-09-08T14:03:00.000Z"
        ),
    ],
    serverTime: "2026-09-09T04:35:00.000Z"
)
