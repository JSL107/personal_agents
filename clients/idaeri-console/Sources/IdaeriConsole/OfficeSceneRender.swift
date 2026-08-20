import AppKit
import ConsoleCore
import SpriteKit

/// 창을 띄우지 않고 사무실 씬을 PNG 로 굽는다 — 화면 회귀 확인용.
///
/// 시각 변경(조명·배치·색)은 눈으로 봐야 판정된다. 그런데 확인 경로가 "앱을 띄우고 사람이
/// 본다" 하나뿐이면, 화면 기록 권한이 없는 환경이나 자동 점검에서는 **그려지긴 했는지조차**
/// 알 수 없다. 실제로 창을 하나 추가하고도 그것이 화면에 나왔는지 확인하지 못한 적이 있다.
///
///     swift run IdaeriConsole --render /tmp/office.png --hour 18
///
/// 시각을 넘기면 그 시간대로 고정해 굽는다 — 밤 화면을 보려고 밤까지 기다릴 수는 없다.
/// 백엔드가 떠 있으면 실제 스냅샷을 쓰고, 없으면 사람 없는 빈 사무실로 굽는다.
func renderOfficeScene(
    client: ConsoleClient,
    path: String,
    hour: Int?,
    size: CGSize,
    poseDemo: Bool,
    hoverAgentType: String? = nil,
    busyDemo: Bool = false,
    alarmDemo: Bool = false,
    debugLabels: Bool = false
) -> Bool {
    let scene = OfficeScene(size: size)
    scene.scaleMode = .resizeFill
    scene.hourOverride = hour
    scene.skipsChoreography = true
    let view = SKView(frame: CGRect(origin: .zero, size: size))
    view.presentScene(scene)

    let snapshot = fetchSnapshotSynchronously(client: client)
    // 데모는 백엔드가 꺼져도 일곱 자세가 모두 보여야 회귀 입구 역할을 한다.
    var renderedAgents = poseDemo ? poseDemoAgents() : snapshot?.agents ?? []
    if busyDemo {
        // 백엔드가 꺼져 있으면 사람이 0명이라 이 모드는 **빈 사무실을 성공으로 저장한다.**
        // 말풍선 겹침을 보려고 만든 입구인데 정작 확인 대상이 하나도 없는 그림이 나오고,
        // 종료 코드가 0 이라 자동 점검은 통과로 읽는다(실제로 그 그림을 대조군으로 쓸 뻔했다).
        guard !renderedAgents.isEmpty else {
            FileHandle.standardError.write(
                Data(
                    "--busy-demo 는 사람이 있어야 한다 — 스냅샷이 비었다"
                        .appending(" (백엔드와 IDAERI_CONSOLE_URL 확인)\n").utf8
                )
            )
            return false
        }
        renderedAgents = renderedAgents.map(busyDemoAgent)
    }
    var renderedApprovals = poseDemo ? [] : snapshot?.approvals ?? []
    if alarmDemo {
        // 실 백엔드는 지금(2026-08) 승인 대기가 0건이라, 이 데모 없이는 대표 경고등이
        // 절대 화면에 뜨지 않는다 — `--busy-demo`가 항상 0~2명뿐인 진행 중 상태를 강제로
        // 세우는 것과 같은 이유로, 카드가 실제로 쌓이길 기다리지 않고 회귀를 확인하려면
        // 이 입구가 필요하다.
        renderedAgents.append(alarmDemoAgent())
        renderedApprovals.append(alarmDemoApproval())
    }
    let renderedRuns = poseDemo ? [] : snapshot?.runs ?? []
    let renderedSessions = poseDemo ? [] : snapshot?.sessions ?? []
    scene.sync(agents: renderedAgents, approvals: renderedApprovals)
    // 세션도 함께 그린다 — 빠뜨리면 실제 앱에만 있는 사람들이 회귀 확인에서 통째로 빠진다
    // (세션 이름표가 서로 겹쳐 못 읽던 문제가 이 구멍으로 렌더 점검을 빠져나갔다).
    scene.syncSessions(renderedSessions)
    scene.updateCompanySummary(renderedAgents)
    // 말풍선·경과·승인 배지는 오버레이라 sync 로는 그려지지 않는다. 빼면 이 화면으로
    // 확인할 수 있는 대상에서 "무슨 일 중" 문구가 통째로 빠진다.
    scene.refreshOverlays(
        agents: renderedAgents,
        runs: renderedRuns,
        pendingCommands: [],
        now: Date()
    )
    // 회의실 판과 정산 종이도 함께 굽는다. 빠뜨리면 "안 그리는 요소는 정상으로 보인다" 는
    // 사각지대가 그대로 생긴다 — 판이 벽을 넘치는지, 종이가 대표를 덮는지가 이 경로에서만 보인다.
    let briefing = poseDemo ? nil : fetchBriefingSynchronously(client: client)
    scene.refreshBriefing(briefing, hour: hour ?? Calendar.current.component(.hour, from: Date()))

    if poseDemo, !scene.applyPoseDemo() {
        FileHandle.standardError.write(Data("자세 데모에 필요한 사람 또는 가구가 부족하다\n".utf8))
        return false
    }
    // 호버 쪽지는 마우스 이벤트로만 뜨므로 정지 렌더에는 안 잡힌다. 판이 무엇을 가리는지가
    // 이 변경의 요점이라, 확인 경로가 없으면 회귀가 조용히 돌아온다.
    if let hoverAgentType, !scene.previewHoverTooltip(agentType: hoverAgentType) {
        FileHandle.standardError.write(
            Data("호버 쪽지를 띄우지 못했다: \(hoverAgentType)\n".utf8)
        )
        return false
    }

    // 진단선은 모든 배치가 끝난 뒤에 얹는다 — 중간에 얹으면 그 뒤 갱신으로 글자가 움직여
    // 상자가 실제 위치를 가리키지 않게 된다.
    if debugLabels {
        officeOverlayDebugLabels(on: scene)
    }

    guard
        let texture = view.texture(from: scene),
        let image = texture.cgImage() as CGImage?
    else {
        FileHandle.standardError.write(Data("씬을 이미지로 만들지 못했다\n".utf8))
        return false
    }
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        return false
    }
    do {
        try data.write(to: URL(fileURLWithPath: path))
        return true
    } catch {
        FileHandle.standardError.write(Data("PNG 저장 실패: \(error)\n".utf8))
        return false
    }
}

/// 실제 조직 인원과 무관한 렌더 전용 표본. 여섯 방을 모두 만들면 사물함까지 카탈로그에 포함된다.
///
/// 자세 종류(7)가 아니라 **상호작용 가구 종류(20)** 만큼 세운다. 자세별로 한 명만 세우면 그 자세를
/// 대표하는 가구 하나만 화면에 나오는데, 자세가 어색해지는 지점은 자세가 아니라 **가구**에 있다 —
/// 앉기를 회의 테이블에서만 확인하고 넘어가면 소파에서 몸이 가구에 닿는지는 끝까지 안 보인다
/// (실제로 그 차이 때문에 앉은 사람이 바닥에 쭈그려 앉은 것처럼 보였다).
/// 자세 데모용 agentType. 이름을 만드는 쪽(여기)과 찾는 쪽(`applyPoseDemo`)이 어긋나면
/// 데모가 조용히 비거나 이름표와 자세가 뒤섞인다 — 한 곳에서만 만든다.
func poseDemoAgentType(for kind: FurnitureKind) -> String {
    "POSE_DEMO_\(kind.rawValue)"
}

/// 전원을 진행 중으로 세워 머리 위 상시 말풍선을 강제로 띄운다(렌더 전용).
///
/// 말풍선은 일이 도는 사람에게만 붙는다(`agentTokenInfo`). 그런데 평소 사무실은 29명 중
/// 0~2명만 진행 중이라, 부서 문패가 말풍선을 덮는지를 **확인하려는 순간에만 대상이 없다.**
/// 실제로 그 겹침은 여섯 달 동안 화면에 있었는데도 회귀 렌더에는 한 번도 잡히지 않았다.
///
/// 문구는 실측 상한(`ACTIVITY_BUBBLE_MAX_LENGTH` = 12자)에 맞춘 최장 예시를 쓴다 — 짧은
/// 문구로 확인하면 폭이 남의 자리를 넘는지가 보이지 않는다.
private func busyDemoAgent(_ agent: ConsoleAgent) -> ConsoleAgent {
    agent.replacing(state: .inProgress, bubble: "#2999 리뷰 중")
}

/// 대표 경고등 데모용 agentType. `poseDemoAgentType`과 같은 명명 관례 — 실제 조직 인원과
/// 절대 겹치지 않게 이름을 여기서만 만든다.
private let alarmDemoAgentType = "ALARM_DEMO"

/// 승인 대기 줄에 서 있는 사람 하나(`AWAITING_APPROVAL`)를 만든다. `applyApprovalPressure`가
/// 방치 압력을 매기려면 승인 카드뿐 아니라 화면에 캐릭터 노드도 있어야 하므로 함께 만든다.
private func alarmDemoAgent() -> ConsoleAgent {
    ConsoleAgent(
        agentType: alarmDemoAgentType,
        displayName: "경고등 데모",
        slashCommands: [],
        description: "",
        state: .awaitingApproval,
        bubble: "",
        department: Department.executive.rawValue
    )
}

/// TTL(1시간) 중 50분이 지난 승인 카드 — 소진율 83%로 경고 문턱(80%)은 넘기되 아직
/// 만료 전이다. "임박"을 보여주려는 것이지 "이미 지남"을 보여주려는 게 아니라 일부러
/// 만료 전 시각을 쓴다.
private func alarmDemoApproval() -> ConsoleApproval {
    let now = Date()
    let createdAt = now.addingTimeInterval(-50 * 60)
    let expiresAt = createdAt.addingTimeInterval(60 * 60)
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return ConsoleApproval(
        id: "alarm-demo",
        agentType: alarmDemoAgentType,
        title: "경고등 데모",
        createdAt: formatter.string(from: createdAt),
        expiresAt: formatter.string(from: expiresAt)
    )
}

private func poseDemoAgents() -> [ConsoleAgent] {
    let departments: [Department] = [
        .planning, .engineering, .review, .executive, .growth, .internalOps,
    ]
    let interactionKinds = FurnitureKind.allCases.filter { $0.interactionPose != nil }
    return interactionKinds.enumerated().map { index, kind in
        ConsoleAgent(
            agentType: poseDemoAgentType(for: kind),
            // 이름표가 곧 무엇을 보고 있는지의 설명이 된다 — 가구 이름을 그대로 쓴다.
            displayName: kind.rawValue,
            slashCommands: [],
            description: "",
            state: .waiting,
            bubble: "",
            department: departments[index % departments.count].rawValue
        )
    }
}

/// 대표 브리핑도 같은 방식으로 기다렸다가 그린다. 없으면 회의실 판이 통째로 안 그려지므로
/// 호출자가 그 사실을 알 수 있게 nil 을 그대로 돌려준다.
func fetchBriefingSynchronously(client: ConsoleClient) -> ConsoleBriefing? {
    let semaphore = DispatchSemaphore(value: 0)
    var result: ConsoleBriefing?
    Task {
        result = try? await client.fetchBriefing()
        semaphore.signal()
    }
    guard semaphore.wait(timeout: .now() + 5) == .success else {
        return nil
    }
    return result
}

/// 렌더는 한 장을 굽고 끝나는 일회성 실행이라, 스냅샷을 기다렸다가 그리는 편이 단순하다.
/// 실패해도 빈 사무실로 굽는다 — 백엔드가 꺼져 있다고 화면 확인까지 막힐 이유는 없다.
func fetchSnapshotSynchronously(client: ConsoleClient) -> ConsoleSnapshot? {
    let semaphore = DispatchSemaphore(value: 0)
    var result: ConsoleSnapshot?
    Task {
        result = try? await client.fetchSnapshot()
        semaphore.signal()
    }
    // 렌더가 백엔드 응답에 매달려 멈추지 않게 상한을 둔다.
    //
    // **신호를 받았을 때만 결과를 읽는다.** 타임아웃으로 빠져나온 뒤 읽으면, 아직 살아 있는
    // 작업의 쓰기와 여기의 읽기가 같은 변수에서 겹쳐 데이터 경합이 된다. `signal()` 을 받은
    // 경우에는 쓰기가 그보다 먼저 끝난 것이 보장되므로 안전하다.
    guard semaphore.wait(timeout: .now() + 5) == .success else {
        return nil
    }
    return result
}
